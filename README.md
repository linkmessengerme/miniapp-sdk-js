# Link Mini Apps JavaScript SDK

`@link-apps/miniapp` — браузерный SDK для Mini Apps в Link. Получает контекст
авторизованного запуска, свежие данные пользователя и закрывает приложение.
ES modules, TypeScript declarations, без runtime-зависимостей и сборщика.

Версия `0.1.0` подготовлена к первому выпуску; в npm пока не опубликована.
Репозиторий до выпуска приватный. Нативные host bridge Android/iOS и проверки
на устройствах — отдельный этап; установка этого пакета их не добавляет.

## Установка

До публикации установите проверенный архив из checkout репозитория:

```sh
npm ci --ignore-scripts
npm run check
mkdir -p dist
npm pack --pack-destination dist
# В проекте Mini App:
npm install /absolute/path/link-apps-miniapp-0.1.0.tgz
```

После выпуска в npm команда будет `npm install @link-apps/miniapp`.
Пакет предназначен для современного браузера/WebView с `fetch`, Web Crypto,
ReadableStream и AbortController. Адаптер использует MessageChannel.
Для разработки SDK требуется Node.js 20+; CI проверяет Node.js 22 и 24.

## Вход и профиль

Выполняйте код в основном документе Mini App после открытия из Link:

```js
import LinkMiniApp from '@link-apps/miniapp';

const context = await LinkMiniApp.init();
// context.user: { sub, name, username, avatarUrl }

const info = await LinkMiniApp.getUserInfo();
// info: { sub, name?, username?, avatarUrl?, phoneNumber?, phoneNumberVerified? }

// По действию пользователя:
await LinkMiniApp.close();
```

`init()` получает текущий `READY` от host, проверяет origin, окружение и срок.
Он возвращает `idToken`, необязательный `accessToken`, `scopes`, `user`, `appId`,
`launchId`, `environment` и `expiresAt` (Unix time в миллисекундах).
Host выдаёт данные после авторизации в Link и согласия пользователя.
В Live нужен HTTPS; Test допускает HTTP на `localhost`, `127.0.0.1`, `[::1]`,
если точный origin с портом зарегистрирован в настройках приложения.

`sub` — идентификатор пользователя в конкретном Mini App и окружении.
Данные из JS подходят для интерфейса. Для входа на собственный backend
передайте `context.idToken` на свой HTTPS endpoint и проверьте его на сервере,
после чего выдайте свои access/refresh tokens. Основной токен аккаунта Link
страница Mini App не получает.

## Свежие данные и разрешения

`getUserInfo()` сам вызывает `init()`, получает текущий scoped access token
и делает `GET https://api-sdk.linkmessenger.me/miniapps/v1/userinfo`.
Он проверяет совпадение `sub`, возвращает только разрешённые поля и не кеширует
результат. Одновременные вызовы делят один запрос. При ошибке сохранённый профиль
из `init()` не подставляется вместо свежих данных.

Метод не принимает token, user ID или scopes и не показывает согласие.
Разрешения выбираются в Console до запуска. `profile` обязателен; `phone`
требует допуска проекта, включения в нужном окружении и отдельного согласия.
Отказ от телефона не мешает входу. Изменение Live-настроек проходит review.

```ts
import LinkMiniApp, { type MiniAppUserInfo } from '@link-apps/miniapp';

const info: MiniAppUserInfo = await LinkMiniApp.getUserInfo();
const phone = info.phoneNumber ?? null;
```

Отсутствующее поле означает, что данных нет или они не разрешены.
Номер имеет формат `+` и цифры. Не считайте его подтверждённым по факту наличия:
текущий API не возвращает `phoneNumberVerified`. В `context.user` и ID token
номер не входит. После отзыва доступа ранее полученные данные нужно убрать
из интерфейса; собственная сессия backend имеет независимые срок и отзыв.

Scoped access token живёт до `expiresAt` (60 секунд); host продлевает запуск
каждые 30 секунд. SDK запрашивает у host актуальный токен при каждом вызове.
Он передаёт его только в `Authorization`, без cookies, redirects или кеша.
Токены нельзя помещать в URL, логи и browser storage.

Для доверенной конфигурации регионального API создайте экземпляр один раз:

```js
import { createSDK } from '@link-apps/miniapp';

const miniApp = createSDK(window, {
  apiBaseUrl: 'https://api-sdk-fr.linkmessenger.me',
});
const info = await miniApp.getUserInfo();
```

`apiBaseUrl` — HTTPS origin без path/query/credentials, заданный интегратором.
Не считывайте его из URL или пользовательских данных. HTTP loopback допустим
только для Test. Сервер Mini App может получать UserInfo своим серверным SDK;
этот пакет рассчитан на браузер и host bridge.

## Браузерный адаптер

Для локального веб-стенда импортируйте отдельный экспорт пакета:

```js
import LinkMiniApp from '@link-apps/miniapp';
import { installBrowserHost } from '@link-apps/miniapp/browser-host';

// Доверенная настройка сборки, а не параметр URL.
installBrowserHost(window, { hostOrigin: 'http://localhost:3008' });
const context = await LinkMiniApp.init();
```

Адаптер нужен для Mini App, открытого стендом в отдельном окне. Он не заменяет
существующий native bridge. Проверяет точные origin, opener и nonce; scoped
credentials передаются по привязанному к документу MessagePort. На `pagehide`,
отзыв или истечение lease адаптер закрывается и отправляет `linkminiapp:closed`.
Обработайте это событие, чтобы убрать экран авторизованного приложения.

Для Next.js переменная `NEXT_PUBLIC_LINK_WEB_HOST_ORIGIN` встраивается **при
сборке frontend**. После изменения нужен rebuild. Вызывайте установку адаптера
только в браузере, до `init()`. Live URL Mini App остаётся HTTPS; localhost —
origin локального host. Простое открытие URL Mini App без host не даёт входа.

## Ошибки

SDK использует `MiniAppError.code`; ошибки транспорта адаптера также могут
быть обычным `Error` с безопасным кодом в `message`.

| Код | Действие приложения |
| --- | --- |
| `LINK_REQUIRED` | Предложить открыть Mini App из Link с поддержкой bridge |
| `AUTHORIZATION_REQUIRED` | Попросить host подготовить новый действующий запуск |
| `ACCESS_REVOKED` | Убрать авторизованный экран и завершить текущий запуск |
| `ORIGIN_NOT_ALLOWED`, `NOT_MAIN_FRAME` | Проверить origin и основной документ |
| `HOST_TIMEOUT` | Проверить host, затем предложить новый запуск |
| `TRANSPORT`, `API_TIMEOUT`, `SERVICE_UNAVAILABLE` | Показать сетевую ошибку; повторить по действию пользователя |
| `INVALID_CONFIG`, `INVALID_HOST_RESPONSE`, `INVALID_API_RESPONSE` | Исправить конфигурацию/интеграцию, не использовать ответ |
| `HTTP_ERROR` | Обработать прочий неуспешный ответ API |

В браузере недоступный CORS-ответ тоже выглядит как `TRANSPORT`; JS не может
прочитать его HTTP status. SDK не повторяет автоматически 401/403 и не запрашивает
дополнительные разрешения. Старый host без `access_token` поддерживает `init()`,
но `getUserInfo()` отклоняется с `AUTHORIZATION_REQUIRED`.

## Документация и разработка

- [Контракт host bridge](https://github.com/linkmessengerme/miniapp-sdk-js/blob/main/docs/host-bridge.md)
- [Собственный backend и токены](https://github.com/linkmessengerme/miniapp-sdk-js/blob/main/docs/own-backend.md)
- [Браузерный host и Next.js](https://github.com/linkmessengerme/miniapp-sdk-js/blob/main/docs/browser-host.md)
- [Подготовка и выпуск](https://github.com/linkmessengerme/miniapp-sdk-js/blob/main/docs/releasing.md)

`npm run check` проверяет тесты, типы и установку реального tarball в отдельный
проект. `npm pack` включает только SDK, адаптер, declarations, README, changelog
и MIT license. Стенды, серверный пример, тесты и credentials в npm-пакет не входят.
Документация в репозитории до его открытия доступна только участникам.
