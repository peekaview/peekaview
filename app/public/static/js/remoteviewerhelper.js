document.addEventListener('DOMContentLoaded', function() {
    denyLoadingInTopWindow();
    disableBrowserZoom();
    registerHandlers();
});

var lastOpenRemoteviewer = null;
function openRemoteViewer(roomid, username, userid, color, hostname) {
    if (lastOpenRemoteviewer == userid) return;

    console.log("open remote viewer");
    lastOpenRemoteviewer = userid;

    let remoteviewer = window.document.querySelector('#remoteviewer');
    // should be opened only once
    if (remoteviewer) {
        remoteviewer.remove();
    }

    let ifrm = document.createElement("iframe");
    ifrm.setAttribute("src", "remoteviewer.html?hostname=" + hostname + "&roomid=" + roomid + "&color=" + color + "&username=" + username + "&userid=" + userid + "");
    ifrm.style.cssText = "width: 100vw; height: 100vh; position: absolute; top: 0px; border: 0px; z-index:250";
    ifrm.id = "remoteviewer";
    ifrm.allow = "clipboard-write";

    window.document.querySelector('#remoteviewerwrapper').appendChild(ifrm);
    window.document.querySelector('#remoteviewer').focus();
    window.document.querySelector('#remoteviewer').contentDocument.body.focus();

    repaintRemoteViewer();
}

function closeRemoteViewer() {
    lastOpenRemoteviewer = null;

    let remoteviewer = window.document.querySelector('#remoteviewer');
    // should be opened only once
    if (remoteviewer) {
        console.log("close remote viewer");
        remoteviewer.remove();

        window.document.querySelector('#remoteviewerwrapper').style.overflow = 'hidden';
    }
}

function repaintRemoteViewer() {
    let remoteviewer = window.document.querySelector('#remoteviewer');
    if (remoteviewer) {
        document.querySelector('div#remoteviewerwrapper').style.overflow = 'visible';

        remoteviewer.style.top = '0px';
        remoteviewer.style.left = '0px';
        remoteviewer.style.width = '100vw';
        remoteviewer.style.height = '100vh';
    }
}

function disableBrowserZoom() {
    document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && (e.which === 61 || e.which === 107 || e.which === 173 || e.which === 109 || e.which === 187 || e.which === 189)) {
            e.preventDefault();
        }
    }, false);

    const handleBrowserZoomWheel = function (e) {
        console.log("wheel")
        if (e.ctrlKey || e.metaKey)
            e.preventDefault();
    };
    document.addEventListener("wheel", handleBrowserZoomWheel, { passive: false });
}

function denyLoadingInTopWindow() {
    if (window.self === window.top) {
        //window.location.href = 'about:blank';
    }
}

function checkIfUrlAllowed(url, optionalcompareurl = null) {
    return true;
    //optionalcompareurl = optionalcompareurl ? optionalcompareurl : 'https://' + location.hostname
    //return url.replace(/https:\/\/(be-|fe-|ps-|)/gi, '') === optionalcompareurl.replace(/https:\/\/(be-|fe-|ps-|)/gi, '')
}


function handleMessage(e) {
    //console.log("handleMessage", e);
    // check origin of message
    if (checkIfUrlAllowed(e.origin) && e.data != undefined) {
        try {
            var data = JSON.parse(e.data); // parse stringified data
        } catch (err) {
            var data = { 'action': 'none' };
        }
        if (data.action == 'setscale') {
            
            const wrapper = document.querySelector('div#remoteviewerwrapper');
            const wrapperRect = wrapper.getBoundingClientRect();
            
            if (data.scaleinfo.height < window.innerHeight || data.scaleinfo.width < window.innerWidth) {
                const currentHeight = Math.round(wrapperRect.height);
                const currentWidth = Math.round(wrapperRect.width);
                
                if (data.scaleinfo.height != currentHeight || data.scaleinfo.width != currentWidth) {
                    wrapper.style.height = data.scaleinfo.height + 'px';
                    wrapper.style.width = data.scaleinfo.width + 'px';
                }
            } else {
                wrapper.style.height = '100%';
                wrapper.style.width = '100%';
            }

            wrapper.style.overflow = 'visible';
            document.querySelector('div#remoteviewerwrapper video').style.transform = "scale(" + data.scaleinfo.scale + ") translate(" + data.scaleinfo.x + "px," + data.scaleinfo.y + "px)";

            var obj = {
                "action": 'videosize',
                "sizeinfo": {
                    'x': Math.round(document.querySelector('div#remoteviewerwrapper video').getBoundingClientRect().left),
                    'y': Math.round(document.querySelector('div#remoteviewerwrapper video').getBoundingClientRect().top),
                    'fullwidth': Math.round(document.querySelector('div#remoteviewerwrapper video').getBoundingClientRect().right - document.querySelector('div#remoteviewerwrapper video').getBoundingClientRect().left),
                    'fullheight': Math.round(document.querySelector('div#remoteviewerwrapper video').getBoundingClientRect().bottom - document.querySelector('div#remoteviewerwrapper video').getBoundingClientRect().top),
                    'width': Math.round(document.querySelector('div#remoteviewerwrapper').getBoundingClientRect().right - document.querySelector('div#remoteviewerwrapper').getBoundingClientRect().left),
                    'height': Math.round(document.querySelector('div#remoteviewerwrapper').getBoundingClientRect().bottom - document.querySelector('div#remoteviewerwrapper').getBoundingClientRect().top)
                }
            }
            if (e.source != null) {
                e.source.postMessage(JSON.stringify(obj), '*');
            }
        }
    }
}


// assign handler for message events
function registerHandlers() {
    if (window.addEventListener) {
        window.addEventListener('message', handleMessage, false);
    } else if (window.attachEvent) { // ie8
        window.attachEvent('onmessage', handleMessage);
    }

    window.addEventListener('resize', function (event) {
        repaintRemoteViewer();
    }, true);
}


/*function sendMessage(receiver, msg) {
    document.querySelector(receiver).contentWindow.postMessage(JSON.stringify({
        'action': msg.action,
        'selector': msg.selector,
        'value': msg.value,
        'target': msg.target,
        'successevent': msg.successevent,
        'errorevent': msg.errorevent
    }), '*');
}*/