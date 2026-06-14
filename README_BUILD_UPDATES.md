# KaliLauncher build + updates

## რას აკეთებს ეს build
- Windows installer: `NSIS`
- Linux packages: `AppImage` და `deb`
- Auto-update: GitHub Releases-ით ან generic update server-ით

## ლოკალურად გაშვება
```bash
npm install
npm start
```

## Windows installer
Windows-ზე გაუშვი:
```bash
npm install
npm run dist:win
```
შემდეგ installer იქნება `dist/` ფოლდერში.

## Linux build
Linux-ზე გაუშვი:
```bash
npm install
npm run dist:linux
```
შემდეგ `AppImage` და `deb` იქნება `dist/` ფოლდერში.

## Auto-update GitHub Releases-ით
ყველაზე მარტივი გზაა GitHub repo გამოიყენო.

1. პროექტი ატვირთე GitHub-ზე
2. ეს workflow უკვე დევს: `.github/workflows/build-and-release.yml`
3. როცა ახალი ვერსია გინდა:
```bash
git add .
git commit -m "release v3.0.1"
git tag v3.0.1
git push origin main --tags
```
4. GitHub Actions ააწყობს Windows/Linux build-ებს და ატვირთავს release-ში
5. დაყენებული KaliLauncher startup-ზე თვითონ შეამოწმებს update-ს

## Generic update server
თუ GitHub Releases არ გინდა, build-ის წინ მიუთითე update URL:

Windows PowerShell:
```powershell
$env:UPDATE_URL="https://your-domain.com/kalilauncher-updates/"
npm run dist:win
```

Linux bash:
```bash
export UPDATE_URL="https://your-domain.com/kalilauncher-updates/"
npm run dist:linux
```

იმ URL-ზე უნდა იდოს:
- installer/package ფაილები
- `latest.yml` / შესაბამისი update metadata
- `.blockmap` ფაილები

## შენიშვნები
- Java/Minecraft logic უცვლელად რჩება
- update მუშაობს მხოლოდ installer/package build-ებზე, `npm start` dev რეჟიმში არა
- თუ dev რეჟიმში გინდა update-ის ტესტი, ხელით შექმენი `dev-app-update.yml`
