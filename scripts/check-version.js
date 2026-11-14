'use strict';
/**
 * გაშვება: ავტომატურად, "npm run release"-ის წინ (npm-ის prerelease/pre<script> კონვენციით).
 * ამოწმებს, ხომ არ არსებობს ამ ვერსიის release უკვე GitHub-ზე — თუ არსებობს, ჩერდება
 * მაშინვე, სანამ ხანგრძლივ (და ხშირად ნელ) build+upload პროცესს დაიწყებდი ტყუილად.
 */
const pkg = require('../package.json');

async function main() {
  const { owner, repo } = (pkg.build && pkg.build.publish) || {};
  const version = pkg.version;
  if (!owner || !repo || !version) return;

  const tag = 'v' + version;
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`);
  } catch (e) {
    console.warn('⚠ ვერსიის შემოწმება ვერ მოხერხდა (ინტერნეტი/GitHub მიუწვდომელია) — ვაგრძელებთ მაინც.');
    return;
  }

  if (res.status === 200) {
    console.error(`\n✕ ვერსია ${version} (${tag}) უკვე გამოქვეყნებულია: https://github.com/${owner}/${repo}/releases/tag/${tag}`);
    console.error(`  აწიე "version" ველი package.json-ში (მაგ. ${bump(version)}) და ხელახლა გაუშვი "npm run release".\n`);
    process.exit(1);
  }
}

function bump(v) {
  const parts = v.split('.').map(Number);
  parts[2] = (parts[2] || 0) + 1;
  return parts.join('.');
}

main();
