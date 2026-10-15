# Туристический сайт «Шумбрат — Мордовия»

Статический сайт на HTML/CSS/JavaScript. Сборка и установка зависимостей не требуются.

## Структура

```text
mordovia-tourism-github-vercel-fixed/
├── index.html
├── mordovia-traveler-passport.html
├── vercel.json
├── .gitignore
├── .nojekyll
├── README.md
└── assets/
    └── img-*.jpg / img-*.png
```

Изображения вынесены из `index.html` в папку `assets/`, чтобы уменьшить размер HTML-файла и упростить загрузку в GitHub. Не удаляйте папку `assets` и не переименовывайте файлы изображений. Главный файл — `index.html`.

## Публикация через GitHub и Vercel

1. Распакуйте ZIP-архив на компьютере.
2. Создайте пустой репозиторий на GitHub.
3. Загрузите **содержимое этой папки**, а не сам ZIP-архив. Удобнее всего использовать GitHub Desktop: `Add an Existing Repository` / создать локальный репозиторий в распакованной папке, затем `Publish repository`. Через веб-интерфейс GitHub выберите `Add file → Upload files` и перетащите файлы из папки; для `assets/` сохраните саму папку и её содержимое.
4. На Vercel выберите `Add New → Project`, импортируйте репозиторий GitHub.
5. Framework Preset: `Other`. Build Command оставьте пустым, Output Directory — `.` (или значение по умолчанию для статического проекта). Нажмите Deploy.

## Важно

`index.html` и `mordovia-traveler-passport.html` должны лежать в корне проекта, рядом друг с другом; папка `assets` тоже должна быть в корне. Данные профиля в текущей демонстрационной версии хранятся на стороне браузера; это не полноценная серверная авторизация.
