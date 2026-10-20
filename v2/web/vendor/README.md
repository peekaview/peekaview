# Vendored

`noble-schnorr.js` – BIP-340 Schnorr signatures on secp256k1 (needed to sign Nostr events),
bundled from [@noble/curves](https://github.com/paulmillr/noble-curves) 2.0.1 (MIT, audited):

```sh
npm install @noble/curves@2.0.1 esbuild@0.25.10
echo "export { schnorr } from '@noble/curves/secp256k1.js'" > entry.js
npx esbuild entry.js --bundle --format=esm --minify --legal-comments=eof --outfile=noble-schnorr.js
```
