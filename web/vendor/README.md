# Vendored

`noble-schnorr.js` – BIP-340 Schnorr signatures on secp256k1 (needed to sign Nostr events),
bundled from [@noble/curves](https://github.com/paulmillr/noble-curves) 2.0.1 (MIT, audited):

```sh
npm install @noble/curves@2.0.1 esbuild@0.25.10
echo "export { schnorr } from '@noble/curves/secp256k1.js'" > entry.js
npx esbuild entry.js --bundle --format=esm --minify --legal-comments=eof --outfile=noble-schnorr.js
```

`pdfjs/` – [PDF.js](https://github.com/mozilla/pdf.js) 6.3.289 (Apache-2.0), only for the first-page
previews of PDFs in the shared clipboard; loaded on demand:

```sh
npm pack pdfjs-dist@6.3.289 && tar xzf pdfjs-dist-6.3.289.tgz
cp package/build/pdf.min.mjs package/build/pdf.worker.min.mjs package/LICENSE pdfjs/
```
