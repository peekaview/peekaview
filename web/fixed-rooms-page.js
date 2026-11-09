// The script of fixed-rooms.html (kept out of the page: the site's Content-Security-Policy allows
// scripts only from files of its own origin – see deploy/_headers).
import { mountRooms } from './fixed-rooms.js'
import './legal.js'
const p = new URLSearchParams(location.hash.slice(1))
mountRooms(document.getElementById('fixed-rooms'),{profileRoot:document.getElementById('profile'),callId:p.get('call')||'',invitation:p.get('invite')||'',invitationApi:p.get('api')||'',handoff:p.get('handoff')||''})
// Opening another email link in this tab changes only the fragment.
window.addEventListener('hashchange',()=>location.reload())
