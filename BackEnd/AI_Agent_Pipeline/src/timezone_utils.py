from contextvars import ContextVar, Token
from datetime import datetime, timedelta, timezone, tzinfo
from typing import Optional, Tuple
from zoneinfo import ZoneInfo

_client_tz_ctx: ContextVar[Tuple[Optional[str], Optional[int]]] = ContextVar(
    "client_timezone_ctx",
    default=(None, None),
)


def _parse_offset_minutes(offset_minutes) -> Optional[int]:
    if offset_minutes is None or offset_minutes == "":
        return None
    try:
        minutes = int(float(str(offset_minutes).strip()))
    except (TypeError, ValueError):
        return None
    if -720 <= minutes <= 840:
        return minutes
    return None


def set_client_timezone_context(
    tz_name: Optional[str] = None,
    offset_minutes=None,
) -> Token:
    clean_tz = str(tz_name).strip() if tz_name else None
    clean_offset = _parse_offset_minutes(offset_minutes)
    return _client_tz_ctx.set((clean_tz or None, clean_offset))


def reset_client_timezone_context(token: Token) -> None:
    _client_tz_ctx.reset(token)


def get_client_timezone_context() -> Tuple[Optional[str], Optional[int]]:
    return _client_tz_ctx.get()


def resolve_client_tzinfo(
    tz_name: Optional[str] = None,
    offset_minutes=None,
) -> Optional[tzinfo]:
    ctx_tz, ctx_offset = get_client_timezone_context()
    effective_tz = str(tz_name).strip() if tz_name else ctx_tz
    effective_offset = (
        _parse_offset_minutes(offset_minutes)
        if offset_minutes is not None and offset_minutes != ""
        else ctx_offset
    )

    if effective_tz:
        try:
            return ZoneInfo(effective_tz)
        except Exception:
            pass

    if effective_offset is not None:
        return timezone(timedelta(minutes=effective_offset))

    return None


def now_in_client_tz(
    tz_name: Optional[str] = None,
    offset_minutes=None,
) -> datetime:
    tz = resolve_client_tzinfo(tz_name, offset_minutes)
    if tz is not None:
        return datetime.now(timezone.utc).astimezone(tz)
    return datetime.now().astimezone()


def _format_tz_label(dt: datetime) -> str:
    raw_name = (dt.tzname() or "").strip()
    if raw_name and len(raw_name) <= 5 and " " not in raw_name and not raw_name.startswith(("UTC+", "UTC-")):
        return raw_name

    offset = dt.utcoffset()
    if offset is None:
        return ""
    total_mins = int(offset.total_seconds() // 60)
    if total_mins == 0:
        return "UTC"
    sign = "+" if total_mins >= 0 else "-"
    abs_mins = abs(total_mins)
    hours, mins = divmod(abs_mins, 60)
    return f"UTC{sign}{hours:02d}:{mins:02d}"


def format_doc_timestamp(
    value=None,
    tz_name: Optional[str] = None,
    offset_minutes=None,
) -> str:
    dt: Optional[datetime] = None

    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            dt = None
        else:
            iso_candidate = text[:-1] + "+00:00" if text.endswith("Z") else text
            try:
                parsed = datetime.fromisoformat(iso_candidate) if len(text) > 10 else None
                if parsed is not None and parsed.tzinfo is not None:
                    dt = parsed
                else:
                    return text
            except ValueError:
                return text

    if dt is None:
        dt = now_in_client_tz(tz_name, offset_minutes)
    else:
        target_tz = resolve_client_tzinfo(tz_name, offset_minutes)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc).astimezone(target_tz) if target_tz else dt.astimezone()
        elif target_tz is not None:
            dt = dt.astimezone(target_tz)

    hour_12 = dt.strftime("%I").lstrip("0") or "12"
    base_str = f"{dt.strftime('%b')} {dt.day}, {dt.year}, {hour_12}:{dt.strftime('%M:%S %p')}"
    tz_label = _format_tz_label(dt)
    return f"{base_str} {tz_label}" if tz_label else base_str
