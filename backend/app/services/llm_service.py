"""
LLM inference service for PageNode.

Primary path:  Ollama (http://localhost:11434/api/chat) with JSON mode.
Fallback path: llama-cpp-python Llama singleton loaded from llm_model_path setting.

Usage:
    result_dict = await chat_json(system_prompt, user_prompt)
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Lazy singleton for GGUF fallback
_llama_instance: Any | None = None
_llama_model_path: str | None = None


class LLMUnavailableError(Exception):
    """Raised when neither Ollama nor a GGUF model is available/configured."""


async def _resolve_ollama_model() -> str | None:
    """
    Check Ollama for a running model that matches the configured llm_model_id.
    Returns the Ollama model name (e.g. 'qwen2.5:3b') or None.
    """
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get("http://localhost:11434/api/tags", timeout=1.5)
            if res.status_code != 200:
                return None
            ollama_tags: dict[str, list] = res.json()

        ollama_prefixes = {
            m["name"].split(":")[0]
            for m in ollama_tags.get("models", [])
        }

        from app.db.sqlite import get_db, get_setting
        from app.services.model_registry import MODEL_CATALOG

        model_id: str = ""
        async for db in get_db():
            model_id = (await get_setting(db, "llm_model_id")) or ""

        if model_id and model_id in MODEL_CATALOG:
            ollama_name = MODEL_CATALOG[model_id].ollama_name
            if ollama_name:
                prefix = ollama_name.split(":")[0]
                if prefix in ollama_prefixes:
                    return ollama_name
    except Exception:
        pass
    return None


def _get_llama_singleton(model_path: str) -> Any:
    """
    Lazy-load the llama-cpp-python Llama instance.
    Reloads if the model path has changed.
    """
    global _llama_instance, _llama_model_path
    if _llama_instance is None or _llama_model_path != model_path:
        try:
            from llama_cpp import Llama  # type: ignore[import]

            _llama_instance = Llama(
                model_path=model_path,
                n_ctx=2048,
                n_threads=4,
                verbose=False,
            )
            _llama_model_path = model_path
        except Exception as e:
            _llama_instance = None
            _llama_model_path = None
            raise LLMUnavailableError(f"Failed to load GGUF model: {e}") from e
    return _llama_instance


async def chat_json(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 1024,
) -> dict:
    """
    Send a chat request to the LLM expecting JSON output.

    Tries Ollama first; falls back to llama-cpp-python GGUF.
    Returns a parsed dict.
    Raises LLMUnavailableError if neither path is available.
    Raises json.JSONDecodeError if the model returns invalid JSON (caller handles).
    """
    # --- Attempt 1: Ollama ---
    ollama_model = await _resolve_ollama_model()
    if ollama_model:
        try:
            payload = {
                "model": ollama_model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "format": "json",
                "stream": False,
                "options": {"num_predict": max_tokens},
            }
            async with httpx.AsyncClient() as client:
                res = await client.post(
                    "http://localhost:11434/api/chat",
                    json=payload,
                    timeout=120.0,
                )
                res.raise_for_status()
                content = res.json()["message"]["content"]
                return json.loads(content)
        except json.JSONDecodeError:
            raise
        except Exception as e:
            logger.warning("Ollama inference failed (%s), trying GGUF fallback", e)

    # --- Attempt 2: llama-cpp-python GGUF ---
    from app.db.sqlite import get_db, get_setting

    model_path: str = ""
    async for db in get_db():
        model_path = (await get_setting(db, "llm_model_path")) or ""

    if not model_path:
        raise LLMUnavailableError(
            "No LLM configured: Ollama model not found and no GGUF path set."
        )

    def _sync_infer() -> str:
        llama = _get_llama_singleton(model_path)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        result = llama.create_chat_completion(
            messages=messages,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
        return result["choices"][0]["message"]["content"]

    raw = await asyncio.to_thread(_sync_infer)
    return json.loads(raw)
