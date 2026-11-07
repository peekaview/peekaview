// Two words instead of a link – "Tiger Apfel", easy to read out on the phone.
//
// Whoever shares sees two words from WORDS (1024 of them: about a million codes); whoever wants to
// watch types them in and gets the link. The code itself never travels: both sides run a PAKE
// (SPAKE2 on secp256k1) in a public lobby on the Nostr relays, which turns the short code into a
// strong key – and only under that key does the link come back. Somebody listening on the relays
// learns nothing they could try codes against at leisure; somebody guessing has one try per
// question, and the sharer answers at most RATE questions a minute. Joining still needs the
// sharer's yes, like with a link.
//
// No server of ours is involved, the same as for the signalling itself (signal.js).

import { schnorr } from './vendor/noble-schnorr.js'
import { Signaling, hex } from './signal.js'

export const WORDS = `
  aal abend acker adler affe ahorn akazie akkord akkordeon akku albatros alligator alpaka alphorn
  ameise amsel anakonda ananas anemone anker antilope apfel apotheke aprikose ara arena asche assel
  ast aster astronaut athen atoll aue ausflug auster auto axt bach bagel bagger bahn bahnhof baiser
  balkon ball ballett ballon bambus banane banjo bank banner barke barsch basilikum bass batterie
  bauklotz becher beere begonie beil berg bern bernstein besen bett beutel biber biene bild birke
  birne bison bistro blatt blei blitz bluse boa boden bogen bohne bohrer bonbon bongo boot boxen
  bratwurst bremse brett brezel brief brille brise brokkoli brombeere bronze brot brunnen buch buche
  bucht burg bus busch bussard butter cello chips chor clown comic curry dach dachs dackel dahlie
  damm dampfer dattel decke deich delfin delta diamant dickicht dill dingo dinkel dino distel dodo
  dohle domino donner donut dorf dorsch dose drache dreieck drohne dromedar drossel drucker dublin
  dudelsack dunst dusche ebbe ebene eber echse edelweiss efeu eibe eiche eichel eimer einhorn eis
  eisen eisvogel eiszapfen elch elefant elfe elster emu ente enzian erbse erdbeere erde erika erle
  esche esel essig eule fabel fackel faden fagott fahne fahrrad falke falter farbe farn fasan
  faultier feder fee feier feige feile feld fell fels fenchel fenster ferien ferkel fernrohr fest
  feuerzeug fichte film filz fink fisch fjord flagge flamingo flamme flasche flieder flieger fliese
  floh flosse fluss flut fohlen forelle foto frachter fregatte frettchen freude frosch frost fuchs
  funke gabel galaxie galeere gans garage gardine garnele garten gazelle gecko gedicht geier geige
  gelee gepard geranie gerste geschenk geweih gewitter geysir gimpel ginster gipfel giraffe girlande
  gitarre glas gleiter gletscher globus glocke glut gnom gnu gold golf gondel gong gorilla graben
  granit gras grat greif grille gulasch gurke hafen hafer hagebutte hagel hahn hai hammer hamster
  handschuh handtuch hang hangar harfe harke harz hase haus hecht hecke heft heide heizung helm hemd
  henne herberge herbst herd hering hermelin herz heu himbeere himmel hirsch hirse hirte hobel
  hocker hockey hof holunder holz honig horizont horn hornisse hortensie hose hotel hufeisen huhn
  hummel hummer hund hut ibis idee igel iglu iltis ingwer insel jacht jacke jade jaguar jahrmarkt
  jasmin joghurt jojo judo jupiter kabel kachel kaffee kahn kairo kaiser kajak kakadu kakao kaktus
  kalb kalender kamel kamera kamille kamin kamm kanal kaninchen kanne kantine kanu kapelle kappe
  karamell karate kardamom karotte karpfen karte kartoffel karton karussell kasper kastanie kater
  katze kauz kegel keiler keks kelle keller kerbel kern kerze kessel ketchup kette kiebitz kiefer
  kies kiesel kino kiosk kirche kirsche kissen kiste kiwi klavier kleber klee kleid klingel klippe
  knoblauch knopf knospe koala kobold kobra koch koffer kogge kohl kohle kohlrabi koi kojote kokos
  kolibri komet kommode kompass kompott kondor konfetti konzert koralle korb koriander kormoran
  krabbe krake kralle kran kranich krapfen krater krawatte krebs kreide kreis kreisel kresse
  kristall krokant krokodil krokus krone krug kuchen kuckuck kugel kuh kupfer kuppe kutsche kutter
  lachs laden lagune lakritz lama lamm lampe landkarte languste lappen lasagne laster laterne lauch
  lava lavendel lawine lebkuchen leder legende leguan lehm leiter lemming lenker leopard lerche
  leuchte libelle lichtung liege lilie limonade linde lineal linse lissabon london lorbeer lotus
  luchs lupe lupine lurch madrid magie magma magnolie mais makrele makrone mammut mandel mandoline
  mango mantel mappe marder markt marmelade marmor mars marzipan mast matratze matrose maulwurf maus
  medaille meise melisse melodie melone mensa merkur messer messing meteor metzgerei mikado milch
  mimose minze mistel mistgabel mittag mixer mofa mohn molch mole mond monsun moor moos moped mops
  morgen motorrad motte muffin mulde murmel muschel museum muskat mythos nacht nadel nagel narzisse
  nashorn natter nebel nektar nelke neptun nerz nessel nilpferd nixe note notiz nougat nudel
  nudelholz nuss oase oboe ofen okapi olive omelett opal oper orange orbit orca orchidee ordner
  oregano orgel orkan oslo otter oval ozelot paddel paket palast palme panda panther pantoffel
  papagei papaya papier pappel paprika paris park passat pauke pavian pelikan pelz pension perle
  pfanne pfau pfeffer pfeife pfeil pferd pfirsich pflaume pfote phoenix picknick pier pilot pilz
  pinguin pinie pinsel pinzette pirat pirol pizza pizzeria planet platin platz pluto pokal polenta
  polka pollen pony popcorn posaune prag praline primel prinz pudding pudel pullover puma puppe pute
  pyramide quadrat qualle quark quarz quelle quitte rabe radio rahmen rakete rassel rathaus ratte
  rauch raupe raureif raute ravioli rebhuhn rechen regal regen reh rehkitz reibe reifen reiher reis
  rentier rettich rhabarber riese riesenrad riff riga rind rinde ring ritter robbe rochen rock
  rodeln roggen roller rollo rom roman rose rosine rosmarin rubin rucksack ruder ruderboot rugby
  rumba rutsche safran saft sage sahne salat salbei salsa salz samba samen samt sand sandale sardine
  satellit sattel saturn sauna saurier savanne schach schaf schakal schal schale schalter schatz
  schauer schaufel schaukel schemel schere scheune schiff schild schilf schinken schirm schleife
  schleuse schlitten schloss schlucht schnabel schnecke schnee schnitzel schnur scholle schotter
  schrank schraube schublade schuh schule schwalbe schwamm schwan see seehund seeigel seekuh
  seestern segel segelboot segeln seide seife seil seilbahn sellerie semmel senf senke serviette
  sessel sieb silber sirup sittich ski socke sofa sofia sommer sonne sorbet spargel spaten spatz
  specht sperling sphinx spiegel spinat spinne spirale spitzer stachel stadion stadt stall stamm
  star staudamm steckdose stecker stein stempel steppe stern stiefel stieglitz stift stinktier stoff
  stollen storch strand strauch stroh strudel stuhl sturm sumpf suppe surfen tablett tafel takt tal
  taler tamburin tandem tango tanne tapir tasche tasse taste tau taube taxi teddy tee teich telefon
  teller tempel tennis teppich theater thermos thron thunfisch thymian tiger tisch toast toaster
  tofu tokio tomate topf tor tornado torte traktor tram traum trecker treppe tresor triangel
  trichter trikot troll trommel trompete truhe truthahn tuba tube tuch tukan tulpe tunnel turm
  turnhalle ufer ufo uhr uhu ulme umhang uranus urlaub vanille vase veilchen venus villa viper
  vorhang vulkan waage wacholder wachtel waffel wagen wald walross walzer wand wanne waran wasser
  wecker weide weiher weizen welle welpe wels werkstatt wespe weste wiedehopf wiege wien wiese
  wiesel wimpel wind windrad winter wippe wirsing wohnwagen wolf wolke wolle wunder wurm wurst
  wurzel zander zange zapfen zauber zauberer zaun zebra zeder zeisig zeitung zelt zeppelin zepter
  ziege zikade zimt zinn zirkel zirkus zither zitrone zollstock zoo zucker zug zweig zwerg zwieback
  zwiebel zypresse`.trim().split(/\s+/)

const SET = new Set(WORDS)
const LOBBY = 'peekaview/word-code/lobby/v1'
/** questions a sharer answers per minute, at most (each one is one guess for somebody guessing) */
export const RATE = 30
const { Point } = schnorr
const Fn = Point.Fn
const enc = new TextEncoder()
const dec = new TextDecoder()
const big = (bytes) => BigInt('0x' + (hex(bytes) || '0'))
const sha256 = async (data) => new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data))
const b64 = (bytes) => btoa(String.fromCharCode(...bytes))
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const randomScalar = () => Fn.create(big(schnorr.utils.randomSecretKey())) || 1n

/** A fresh code, e.g. "tiger apfel" (show it with displayCode). */
export function newCode() {
  const [a, b] = crypto.getRandomValues(new Uint16Array(2))
  return `${WORDS[a % WORDS.length]} ${WORDS[b % WORDS.length]}`
}

/** "tiger apfel" → "Tiger Apfel" */
export const displayCode = (code) => code.replace(/(^|\s)([a-z])/g, (_, s, c) => s + c.toUpperCase())

/**
 * What somebody typed – "Tiger Apfel", "tiger-apfel", "TigerApfel", "Tíger, Äpfel" – as the
 * codes it may mean (usually one; none when it is not two of our words).
 */
export function parseCode(text) {
  const plain = String(text ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
  const parts = plain.split(/[^a-z]+/).filter(Boolean)
  if (parts.length === 2) return SET.has(parts[0]) && SET.has(parts[1]) ? [parts.join(' ')] : []
  if (parts.length !== 1) return []
  // run together: every way it splits into two of our words
  const [one] = parts
  const codes = []
  for (let i = 3; i <= one.length - 3; i++) if (SET.has(one.slice(0, i)) && SET.has(one.slice(i))) codes.push(`${one.slice(0, i)} ${one.slice(i)}`)
  return codes
}

/** Looks like somebody tried a code (two words, no link)? */
export const looksLikeCode = (text) => /^\s*[\p{L}]+[\s,.\-–_/]*[\p{L}]+\s*$/u.test(String(text ?? '')) && !/^\s*https?:/i.test(text)

// SPAKE2: two points nobody knows a discrete logarithm of (hashed onto the curve)
let points
async function MN() {
  const lift = async (tag) => {
    for (let i = 0; ; i++) {
      try {
        return schnorr.utils.lift_x(big(await sha256(`${tag}:${i}`)))
      } catch {}
    }
  }
  points ??= Promise.all([lift('peekaview/word-code/M/v1'), lift('peekaview/word-code/N/v1')])
  return points
}
const password = async (code) => Fn.create(big(await sha256(`peekaview/word-code/v1:${code}`))) || 1n

async function sessionKey(X, Y, K, w) {
  const bytes = [enc.encode('peekaview/word-code/key/v1'), X.toBytes(true), Y.toBytes(true), K.toBytes(true), Fn.toBytes(w)]
  const all = new Uint8Array(bytes.reduce((n, b) => n + b.length, 0))
  let at = 0
  for (const b of bytes) all.set(b, (at += b.length) - b.length)
  return crypto.subtle.importKey('raw', await sha256(all), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/** The lobby every code question and answer goes through – the Nostr relays (tests pass their own). */
const relayLobby = (relays) => async (onMessage) => Signaling.open({ secret: LOBBY, relays, onMessage })

/**
 * As the sharer: answers who asks with the right code – with `link` (and `name`).
 * @param {{link: string, name?: string, code?: string, relays?: string[], lobby?: Function, onAnswer?: () => void}} options
 * @returns {Promise<{code: string, close: () => void}>}
 */
export async function offerCode({ link, name = '', code = newCode(), relays, lobby = relayLobby(relays), onAnswer }) {
  const [M, N] = await MN()
  const w = await password(code)
  const wN = N.multiply(w)
  const wM = M.multiply(w)
  const answered = new Map()
  let recent = []
  let channel = null
  let closed = false
  async function answer(msg) {
    if (msg?.t !== 'pv-code-ask' || typeof msg.id !== 'string' || msg.id.length > 40 || typeof msg.X !== 'string') return
    // the same question again (it is asked a few times, to reach relays that came later)
    if (answered.has(msg.id)) return channel?.send(answered.get(msg.id))
    const now = Date.now()
    recent = recent.filter((t) => now - t < 60000)
    if (recent.length >= RATE) return
    recent.push(now)
    try {
      const X = Point.fromHex(msg.X)
      const y = randomScalar()
      const Y = Point.BASE.multiply(y).add(wN)
      const K = X.subtract(wM).multiply(y)
      if (K.is0()) return
      const key = await sessionKey(X, Y, K, w)
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const box = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify({ link, name }))))
      const reply = { t: 'pv-code-answer', id: msg.id, Y: Y.toHex(true), box: b64(new Uint8Array([...iv, ...box])) }
      answered.set(msg.id, reply)
      if (answered.size > 200) answered.delete(answered.keys().next().value)
      if (!closed) channel?.send(reply)
      onAnswer?.()
    } catch {
      // not a point on the curve – nothing to answer
    }
  }
  channel = await lobby((msg) => void answer(msg))
  if (closed) channel.close()
  return {
    code,
    close() {
      closed = true
      channel?.close()
    },
  }
}

/**
 * As the viewer: asks for the share behind a code (as typed). Resolves with {link, name}, rejects
 * with Error('code') when it is not a code, Error('timeout') when nobody answered.
 * @param {string} text
 * @param {{timeout?: number, relays?: string[], lobby?: Function, signal?: AbortSignal}} [options]
 */
export async function findByCode(text, { timeout = 15000, relays, lobby = relayLobby(relays), signal } = {}) {
  const codes = parseCode(text)
  if (!codes.length) throw new Error('code')
  const [M, N] = await MN()
  const asks = await Promise.all(
    codes.map(async (code) => {
      const w = await password(code)
      const x = randomScalar()
      const X = Point.BASE.multiply(x).add(M.multiply(w))
      return { id: hex(crypto.getRandomValues(new Uint8Array(12))), w, x, X, wN: N.multiply(w) }
    }),
  )
  return new Promise((resolve, reject) => {
    let channel = null
    let done = false
    let again = 0
    const finish = (fn, value) => {
      if (done) return
      done = true
      clearInterval(again)
      clearTimeout(timer)
      channel?.close()
      fn(value)
    }
    const timer = setTimeout(() => finish(reject, new Error('timeout')), timeout)
    signal?.addEventListener('abort', () => finish(reject, new Error('aborted')))
    async function hear(msg) {
      const ask = msg?.t === 'pv-code-answer' && asks.find((a) => a.id === msg.id)
      if (!ask || done) return
      // anybody can answer (and all sharers with a code do) – only the one with this code can
      // say something that opens under the key
      try {
        const Y = Point.fromHex(msg.Y)
        const K = Y.subtract(ask.wN).multiply(ask.x)
        if (K.is0()) return
        const key = await sessionKey(ask.X, Y, K, ask.w)
        const raw = unb64(msg.box)
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12))
        const { link, name } = JSON.parse(dec.decode(plain))
        if (typeof link === 'string') finish(resolve, { link, name: typeof name === 'string' ? name.slice(0, 64) : '' })
      } catch {}
    }
    lobby((msg) => void hear(msg)).then(
      (c) => {
        channel = c
        if (done) return c.close()
        const ask = () => asks.forEach((a) => c.send({ t: 'pv-code-ask', id: a.id, X: a.X.toHex(true) }))
        ask()
        again = setInterval(ask, 3000)
      },
      (e) => finish(reject, e),
    )
  })
}

