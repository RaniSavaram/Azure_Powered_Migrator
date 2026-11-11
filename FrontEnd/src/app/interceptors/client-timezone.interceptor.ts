import { HttpInterceptorFn } from '@angular/common/http';

function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

export const clientTimezoneInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.includes('/api')) {
    return next(req);
  }

  const headers: Record<string, string> = {
    'X-Client-Tz-Offset': String(-new Date().getTimezoneOffset()),
  };
  const tz = getBrowserTimezone();
  if (tz) {
    headers['X-Client-Timezone'] = tz;
  }

  return next(req.clone({ setHeaders: headers }));
};

