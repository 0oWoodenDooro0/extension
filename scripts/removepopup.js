function removepopup() {
  const body = document.getElementsByTagName("body")
  if (body[0] !== undefined) {
    body[0].setAttribute("style", "")
  }
  const popup = document.getElementById("campaign-popup")
  if (popup !== null) {
    popup.setAttribute("style", "display: none;")
  }
  const main_popup = document.getElementsByClassName("z-9999 bg-richBlack/60 fixed top-0 right-0 bottom-0 left-0 flex h-screen w-screen flex-col items-center justify-center")
  if (main_popup[0] !== undefined) {
    main_popup[0].setAttribute("style", "display: none;")
  }
}

document.addEventListener('load', removepopup());
