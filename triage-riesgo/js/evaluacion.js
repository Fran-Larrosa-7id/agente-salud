(function () {
  const steps = ['stepNombre', 'stepMotivo', 'stepPreguntas', 'stepIntensidad', 'stepResultado'];
  let nombre = '';
  let motivoKey = null;
  let respuestas = [];

  function goTo(id) {
    steps.forEach((s) => { document.getElementById(s).hidden = s !== id; });
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  document.getElementById('btnNombreContinuar').addEventListener('click', () => {
    nombre = document.getElementById('inputNombre').value.trim() || 'Paciente';
    renderMotivos();
    goTo('stepMotivo');
  });

  function renderMotivos() {
    const cont = document.getElementById('motivosList');
    cont.innerHTML = Object.keys(TR_MOTIVOS).map((key) =>
      `<button class="tr-motivo-btn" data-motivo="${key}" type="button">${TR_MOTIVOS[key].label}</button>`).join('');
    cont.querySelectorAll('[data-motivo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        motivoKey = btn.dataset.motivo;
        renderPreguntas();
        goTo('stepPreguntas');
      });
    });
  }

  function renderPreguntas() {
    const motivo = TR_MOTIVOS[motivoKey];
    respuestas = new Array(motivo.preguntas.length).fill(null);
    const cont = document.getElementById('preguntasList');
    cont.innerHTML = motivo.preguntas.map((p, i) => `
      <div class="tr-pregunta">
        <div class="tr-pregunta-texto">${p.texto}</div>
        <div class="tr-yn" data-index="${i}">
          <button class="tr-yn-btn" data-val="1" type="button">Sí</button>
          <button class="tr-yn-btn" data-val="0" type="button">No</button>
        </div>
      </div>`).join('');

    cont.querySelectorAll('.tr-yn').forEach((group) => {
      const idx = Number(group.dataset.index);
      group.querySelectorAll('.tr-yn-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          respuestas[idx] = btn.dataset.val === '1';
          group.querySelectorAll('.tr-yn-btn').forEach((b) => b.classList.remove('is-selected'));
          btn.classList.add('is-selected');
          document.getElementById('btnPreguntasContinuar').disabled = respuestas.some((r) => r === null);
        });
      });
    });
  }

  document.getElementById('btnPreguntasContinuar').addEventListener('click', () => goTo('stepIntensidad'));

  const inputIntensidad = document.getElementById('inputIntensidad');
  inputIntensidad.addEventListener('input', () => {
    document.getElementById('intensidadValue').textContent = inputIntensidad.value;
  });

  document.getElementById('btnVerResultado').addEventListener('click', () => {
    const intensidad = Number(inputIntensidad.value);
    const { nivel, score } = trClasificar(motivoKey, respuestas, intensidad);

    const banner = document.getElementById('resultBanner');
    banner.className = 'tr-result-banner tr-bg-' + nivel.id;
    document.getElementById('resultNivel').textContent = nivel.nombre;
    document.getElementById('resultAccion').textContent = nivel.accion;

    document.getElementById('btnSumarCola').onclick = () => {
      trAgregarACola(nombre, TR_MOTIVOS[motivoKey].label, nivel.id, score);
      document.getElementById('btnSumarCola').disabled = true;
      document.getElementById('btnSumarCola').textContent = 'Ya estás en la cola';
      const p = document.getElementById('confirmacionCola');
      p.hidden = false;
      p.textContent = `Te sumamos a la cola de guardia, ${nombre}. Podés ver tu estado en la pantalla de la sala de espera.`;
    };

    goTo('stepResultado');
  });
})();
