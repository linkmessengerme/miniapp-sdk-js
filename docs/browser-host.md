# Браузерный host

`@link-apps/miniapp/browser-host` — адаптер для тестирования Mini App в отдельном
окне браузера. Production native host предоставляет тот же SDK-контракт сам.

## Next.js

В клиентском компоненте запускайте соединение после монтирования:

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { MiniAppContext } from '@link-apps/miniapp';

export function LinkGate() {
  const [context, setContext] = useState<MiniAppContext | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const closed = () => { setContext(null); setError('Запуск завершён'); };
    window.addEventListener('linkminiapp:closed', closed);
    void (async () => {
      const [{ default: sdk }, { installBrowserHost }] = await Promise.all([
        import('@link-apps/miniapp'),
        import('@link-apps/miniapp/browser-host'),
      ]);
      if (!active) return;
      const hostOrigin = process.env.NEXT_PUBLIC_LINK_WEB_HOST_ORIGIN;
      if (hostOrigin) installBrowserHost(window, { hostOrigin });
      const next = await sdk.init();
      if (active) setContext(next);
    })().catch(() => { if (active) setError('Откройте приложение из Link'); });
    return () => { active = false; window.removeEventListener('linkminiapp:closed', closed); };
  }, []);

  if (error) return <p>{error}</p>;
  if (!context) return <p>Входим через Link…</p>;
  return <p>Привет, {context.user.name}</p>;
}
```

Для доверенного локального host соберите frontend с
`NEXT_PUBLIC_LINK_WEB_HOST_ORIGIN=http://localhost:3008`. Это публичная настройка
доверенного origin, не секрет. Не принимайте её из query, postMessage или storage.
Собственная HTTPS-сессия backend создаётся только после проверки ID token.

При переходе с vendored-копии замените оба импорта: основной SDK на
`@link-apps/miniapp`, адаптер на `@link-apps/miniapp/browser-host`. Уберите старый
импорт, устанавливающий `window.LinkMiniApp`: две копии SDK в одном документе
не поддерживаются. Проверенный архив можно установить до публикации в npm.

`installBrowserHost(window, { hostOrigin })` возвращает `true`, если начал
handshake, и `false`, если уже есть bridge, нет opener или это iframe.
`true` не означает завершённый handshake: `init()` дождётся подключения.
Ошибочный origin отклоняется. Host должен быть HTTPS или HTTP loopback без path.
Не используйте `noopener` или несовместимую COOP-политику для тестового popup:
адаптеру нужен исходный opener. Родительская вкладка остаётся открытой.

## Обмен

1. Mini App отправляет opener сообщение `link-miniapp:hello` с `version: 1` и
   случайным `nonce` на заранее заданный точный `hostOrigin`.
2. Host проверяет origin и конкретное окно, создаёт MessageChannel и отвечает
   `link-miniapp:connected` с тем же nonce и одним перенесённым MessagePort.
3. По порту проходят только `init`/`close` в формате [bridge v1](host-bridge.md).
   Широковещательные window messages не содержат токенов или профиля.
4. Host каждые 30 секунд обновляет запуск и передаёт
   `{ type: 'link-miniapp:lease', expires_at: '…' }`. Lease не длиннее 65 секунд.
5. `{ type: 'link-miniapp:revoked' }`, истечение lease, `pagehide` и возврат из
   bfcache прекращают канал. Новый документ требует нового handshake.

Нативные клиенты требуют отдельных bridge и E2E.
