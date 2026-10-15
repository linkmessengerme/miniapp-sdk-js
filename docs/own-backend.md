# Mini App со своим backend и токенами

1. Link проверяет аккаунт и согласие, открывает Mini App с готовым запуском.
2. Frontend вызывает `init()` и отправляет `idToken` на свой HTTPS endpoint входа.
3. Backend проверяет подпись и claims, однократно принимает proof и находит
   собственный аккаунт по `(appId, environment, sub)`.
4. Backend создаёт свою сессию и выдаёт свои access/refresh tokens или защищённую
   HttpOnly cookie. Дальнейшие запросы приложения используют эту сессию.

`context.user` нельзя использовать как серверное доказательство входа. ID token
и scoped access token имеют разные назначения: ID token подтверждает вход,
а opaque `ma_…` token позволяет получать свежие данные через Mini Apps UserInfo.
Основной Link access token разработчику Mini App не нужен и не передаётся.

## Проверка ID token

[server/verify.mjs](../server/verify.mjs) — пример на Node.js без зависимостей,
который можно адаптировать для backend. Он не является экспортом npm-пакета.

Доверенные настройки задаёт сервер разработчика:

- JWKS: `https://api-sdk.linkmessenger.me/miniapps/v1/jwks.json`.
- Issuer: `https://api-sdk.linkmessenger.me/miniapps`.
- Audience: `urn:link:miniapp:<app-id>:live` (или `:test`).
- Алгоритм Ed25519/EdDSA, `typ=miniapp-id+jwt`, `token_use=miniapp_id`.

Проверяйте подпись, issuer, точный audience, app ID, environment, `iat`, `exp`,
`sub`, `launch_id` и `jti`. TTL proof не больше 60 секунд. Не берите JWKS URL,
issuer или audience из присланного токена; используйте доверенную конфигурацию.
Загружайте JWKS по HTTPS с таймаутом, ограничением размера и обработкой ротации.

```js
import { verifyIDToken } from './verify.mjs';

const identity = await verifyIDToken(idToken, {
  issuer: 'https://api-sdk.linkmessenger.me/miniapps',
  appId: configuredAppId,
  environment: 'live',
  jwks: trustedCachedJWKS,
  consumeJti: async (audience, jti, expiresAt) => {
    // Реализуйте атомарный SET NX с TTL до expiresAt, например в Redis.
    // true только для первого использования пары (audience, jti).
    return replayStore.consumeOnce(audience, jti, expiresAt);
  },
});
// Выдать собственную сессию для identity.sub.
```

Пример намеренно оставляет хранилище сессий, CSRF, rate limit, JWKS cache и
идемпотентность вашего endpoint приложению. Повторный `jti` не создаёт вторую
сессию. Сохраните собственную сессию и receipt повтора вместе, чтобы потерянный
HTTP-ответ не заставлял повторно принимать proof. Никогда не логируйте токены.

## UserInfo и отзыв

Для интерфейса `LinkMiniApp.getUserInfo()` берёт свежий scoped access token у host.
Серверный запрос использует `GET /miniapps/v1/userinfo` с `Authorization: Bearer
<scoped-access-token>` и `Accept: application/json`. Проверьте `sub` ответа
против уже проверенной собственной сессии. Поля могут исчезнуть после отзыва
разрешения; не подменяйте ошибку сохранёнными данными как актуальными.

UserInfo не продлевает токен и не выдаёт новые scopes. Истёкший токен host
заменяет новым запуском того же приложения. `phone` возвращается только при проектном допуске и согласии пользователя;
отсутствующий `phone_number_verified` не означает подтверждение номера.

Отзыв доступа в Link прекращает runtime и UserInfo. Собственные токены backend
Mini App имеют независимый жизненный цикл: определите их TTL, refresh и logout
в своём приложении. SDK не обещает автоматически отозвать эти токены.
