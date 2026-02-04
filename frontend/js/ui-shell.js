(() => {
  const layout = document.querySelector(".app-layout");
  const toggle = document.getElementById("sidebar-toggle");

  if (toggle && layout) {
    toggle.addEventListener("click", () => {
      layout.classList.toggle("sidebar-collapsed");
    });
  }
})();
