class DomainError(Exception):
    def __init__(self, message, *, code="validation_error", status=422, fields=None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status = status
        self.fields = fields or {}

    def as_dict(self):
        return {"error": {"code": self.code, "message": self.message, "fields": self.fields}}
