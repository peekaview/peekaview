window.onload = function () {
  //cursorvars = window.process.argv.slice(-4);
  var params = [];
  let i = 0;
  window.process.argv.forEach(function (param) {
    if (i > 0 && param.substring(0, 1) != "-" && param.substring(0, 1) != "/") {
      params.push(param);
    }
    i++;
  });

  document.querySelectorAll(".cursorsignal").forEach((userItem) => {
    userItem.style.backgroundColor = "#" + params[2];
  });
};
