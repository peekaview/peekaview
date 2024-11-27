const {
  //contextBridge,
  ipcRenderer,
} = require('electron')

document.addEventListener("DOMContentLoaded", () => {
  //window.onload = function () {
  ipcRenderer.on('params', function (evt, params) {
    console.log("RECEIVED");
    console.log(params); // Returns: {'SAVED': 'File Saved'}

    if (document.getElementById('title') && params.title) {
      document.getElementById('title').innerHTML = params.title;
    }
    document.getElementById('detail').innerHTML = (params.message != '' ? '<b>' + params.message + '</b>' : '') + (params.message != '' && params.detail != '' ? '<br>' : '') + (params.detail != '' ? params.detail : '');

    if (params.type == 'error') {
      document.querySelector('.f-modal-error').style.display = 'block'
    }
    if (params.type == 'warning') {
      document.querySelector('.f-modal-warning').style.display = 'block'
    }
    if (params.type == 'info') {
      document.querySelector('.f-modal-info').style.display = 'block'
    }
    if (params.type == 'success') {
      document.querySelector('.f-modal-success').style.display = 'block'
    }
    if (params.type == 'download') {
      document.querySelector('.lds-ring').style.display = 'block'
    }

    if (params.type == 'call') {
      var audio = new Audio('../sounds/ringtone.wav');
      audio.play();

      audio.addEventListener('ended', function () {
        this.currentTime = 0;
        this.play();
      }, false);

      document.getElementById('dialogpicture').style.display = 'block'
    }
    if (params.soundfile !== null) {
      var audio = new Audio('../sounds/' + params.soundfile);
      audio.play();
    }

    let buttonindex = 1
    var tabindex = 0
    params.buttons.reverse().forEach(function (buttonname) {
      console.log(buttonname)
      tabindex = ((params.buttons.length - 1) - buttonindex) + 1
      var placeholder = document.createElement('template');

      if (params.buttons.length == 1) {
        placeholder.innerHTML = '<button id="button' +
          tabindex + '" type="submit" value="' + params.defaultId + '" tabindex="' +
          tabindex + '" class="btn ' + (params.windowtype == 'tray' ? 'btn-sm' : '') + ' btn-primary mt-2" style="width: 50%; margin-left: 25%; margin-right: 25%; "><span class="button-text"> ' +
          buttonname + '</span></button>'
      }
      if (params.buttons.length > 1) {
        placeholder.innerHTML = '<button id="button' +
          tabindex + '" type="submit" value="' + (buttonindex == params.buttons.length ? params.defaultId : tabindex) + '" tabindex="' +
          tabindex + '" class="btn ' + (params.windowtype == 'tray' ? 'btn-sm' : '') + ' ' +
          (buttonindex == params.buttons.length ? 'btn-primary' : 'btn-secondary mr-2') + ' mt-2" style="width: ' +
          (Math.abs(100 / params.buttons.length) - 5) + '%; float: ' +
          (buttonindex == params.buttons.length ? 'right' : 'left') + '"><span class="button-text"> ' +
          buttonname + '</span></button>'
      }

      document.getElementById('modalbuttons').appendChild(placeholder.content.firstElementChild);

      document.getElementById('button' + tabindex).addEventListener("click", (event) => {
        reply(params.id, event.currentTarget.value);
      }
      );

      buttonindex++;
    });

    if (params.timeout) {
      setTimeout(() => {
        close()
      }, params.timeout)
    }

    document.getElementById('close').addEventListener("click", (event) => {
      reply(params.id, params.cancelId);
    }
    );

    window.addEventListener("beforeunload", function (e) {
      reply(params.id, params.cancelId);
    }, false);


  });

  let replySent = false;
  function reply(id, result) {
    if (replySent)
      return
    
    if (id !== undefined)
      ipcRenderer.invoke('reply-dialog', id, result);
    replySent = true;
    close()
  }

  function close() {
    document.getElementById('modal-id').classList.add("modalin");
    document.getElementById('modal-id').classList.add("modalout");
    setTimeout(() => {
      window.close()
    }, 200)
  }
});
//}