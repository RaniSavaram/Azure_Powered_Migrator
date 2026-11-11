from AI_Agent_Pipeline.src.timezone_utils import (
    reset_client_timezone_context,
    set_client_timezone_context,
)


class ClientTimezoneMiddleware:
    """Binds X-Client-Timezone / X-Client-Tz-Offset request headers to contextvars."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        tz_name = request.META.get("HTTP_X_CLIENT_TIMEZONE") or request.GET.get("tz")
        offset_minutes = request.META.get("HTTP_X_CLIENT_TZ_OFFSET") or request.GET.get("tz_offset")
        token = set_client_timezone_context(tz_name, offset_minutes)
        try:
            return self.get_response(request)
        finally:
            reset_client_timezone_context(token)

