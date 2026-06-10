from __future__ import annotations


class MindMapError(Exception):
    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}

    def to_dict(self) -> dict:
        return {
            "ok": False,
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
            },
        }


class ValidationError(MindMapError):
    def __init__(self, message: str, details: dict | None = None):
        super().__init__("VALIDATION_ERROR", message, details)


class ConflictError(MindMapError):
    def __init__(self, message: str, details: dict | None = None):
        super().__init__("GRAPH_VERSION_CONFLICT", message, details)


class ToolInputError(MindMapError):
    def __init__(self, message: str, details: dict | None = None):
        super().__init__("TOOL_INPUT_ERROR", message, details)
