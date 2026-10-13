# Host bridge v1

Host Link выполняет авторизацию и consent до открытия Mini App, создаёт запуск
и устанавливает в разрешённом основном документе:

```ts
window.__LinkMiniAppHost.request(packet): Promise<ResponsePacket>
```

Запрос SDK: `{ version: 1, request_id: '<uuid>', method: 'init' }` или `close`.
Ответ: `{ version: 1, request_id: '<тот же uuid>', result: launchResponse }`.
Ошибка: `{ version: 1, request_id: '<тот же uuid>', error: { code: 'ACCESS_REVOKED' } }`.
`close` возвращает пустой `result`. Допускается JSON-строка ответа до 64 KiB.

`init` возвращает актуальный LaunchResponse в snake_case ProtoJSON:

```json
{
  "result": "LAUNCH_RESULT_READY",
  "launch_id": "<launch-uuid>",
  "ready": {
    "app_id": "<app-uuid>",
    "environment": "ENVIRONMENT_LIVE",
    "config_version": "<published-revision>",
    "expires_at": "<ISO-8601 time in the next 60 seconds>",
    "sub": "<pairwise-subject>",
    "scopes": ["profile"],
    "access_token": "<scoped opaque ma_ token>",
    "profile": { "name": "Алиса", "username": "alice", "avatar_url": "" },
    "web": {
      "url": "https://mini.example/",
      "allowed_origins": ["https://mini.example"],
      "id_token": "<signed Mini Apps JWT>"
    }
  }
}
```

`environment` — `ENVIRONMENT_TEST` или `ENVIRONMENT_LIVE`; в JWT это `test`/`live`.
Старые host могут не передавать scopes/access_token: SDK предполагает только
`profile`, а `getUserInfo()` требует access_token нового контракта.

## Обязанности host

- Привязать bridge к фактическому origin, основному документу, WebView и запуску.
  Проверки выполняются host, а не только JavaScript-кодом страницы.
- Проверять redirects и навигацию. Не выдавать данные iframe; закрывать bridge
  при внешнем переходе, отзыве или смене конфигурации.
- Live — только HTTPS. В Test разрешён HTTP loopback с точным origin и портом
  из `allowed_origins`. Локальный адрес сам по себе не заменяет авторизацию.
- Обновлять запуск через `renew` каждые 30 секунд; READY истекает через 60 секунд.
  Если ответ больше не READY или сеть не позволяет продлить lease, завершить экран.
- Держать основной токен аккаунта Link у host. Mini App получает только свои
  короткоживущие ID/access tokens; без URL, storage и broadcast postMessage.
- После `close` прекратить выдачу данных. Собственная сессия backend Mini App
  имеет отдельный срок; отзыв Link не уничтожает её автоматически.

SDK использует только `init` и `close`. Он не вызывает API согласия и не добавляет
scopes самостоятельно. Все исходы consent/availability до READY обрабатывает host.
Браузерная реализация описана в [browser-host.md](browser-host.md).
