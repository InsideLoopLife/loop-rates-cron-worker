# Run this in the loop-rates-cron-worker repo to remove the orphaned files

cd loop-rates-cron-worker
rm -rf app lib
git add -A
git commit -m "Remove orphaned Next.js-shaped files — this repo runs node src/run.mjs, not Next.js"
git push
