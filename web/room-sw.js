// No cached UI or credentials: a push only wakes the browser and displays an expiring call.
self.addEventListener('push', event => {
  event.waitUntil((async()=>{
    const call=event.data?.json()
    const id=call?.answered_call ?? call?.call
    if(!call || !/^[0-9a-f]{16}$/.test(id) || call.expires*1000<Date.now()) return
    const api=new URL(call.api)
    if(api.protocol!=='https:') return
    if(call.answered_call){
      for(const notification of await self.registration.getNotifications({tag:`peekaview-${id}`}))notification.close()
      return
    }
    await self.registration.showNotification(call.admitted?'PeekaView: Du kannst teilnehmen':'PeekaView: eingehender Anruf',{
      body:call.admitted?'Du wurdest zum Gespräch zugelassen.':`${String(call.caller).slice(0,80)} ruft an`,tag:`peekaview-${call.call}`,requireInteraction:true,
      data:{call:call.call,api:api.href,expires:call.expires},
    })
  })())
})
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const data=event.notification.data
  if(!data || data.expires*1000<Date.now()) return
  const url=new URL('fixed-rooms.html',self.registration.scope)
  url.hash=new URLSearchParams({call:data.call,api:data.api}).toString()
  event.waitUntil(clients.openWindow(url.href))
})
