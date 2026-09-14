(function () {
  const steps = ['stepNombre', 'stepMotivo', 'stepPreguntas', 'stepIntensidad', 'stepResultado'];
  let nombre = '';
  let motivoKey = null;
  let respuestas = [];

  function goTo(id) {
    steps.forEach((s) => { document.getElementById(s).hidden = s !== id; });
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    const heading = document.querySelector('#' + id + ' h1');
    if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus(); }
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
        <div class="tr-yn" data-index="${i}" role="group" aria-label="${p.texto}">
          <button class="tr-yn-btn" data-val="1" type="button" aria-pressed="false"><svg class="tr-yn-btn-check" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>Sí</button>
          <button class="tr-yn-btn" data-val="0" type="button" aria-pressed="false"><svg class="tr-yn-btn-check" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>No</button>
        </div>
      </div>`).join('');

    cont.querySelectorAll('.tr-yn').forEach((group) => {
      const idx = Number(group.dataset.index);
      group.querySelectorAll('.tr-yn-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          respuestas[idx] = btn.dataset.val === '1';
          group.querySelectorAll('.tr-yn-btn').forEach((b) => { b.classList.remove('is-selected'); b.setAttribute('aria-pressed', 'false'); });
          btn.classList.add('is-selected');
          btn.setAttribute('aria-pressed', 'true');
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
    document.getElementById('resultNivel').innerHTML = `<svg class="tr-result-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg><span>${nivel.nombre}</span>`;
    document.getElementById('resultAccion').textContent = nivel.accion;

    document.getElementById('btnSumarCola').onclick = () => {
      trAgregarACola(nombre, TR_MOTIVOS[motivoKey].label, nivel.id, score);
      document.getElementById('btnSumarCola').disabled = true;
      document.getElementById('btnSumarCola').textContent = 'Ya estás en la cola';
      const p = document.getElementById('confirmacionCola');
      p.hidden = false;
      p.setAttribute('tabindex', '-1');
      p.textContent = `Te sumamos a la cola de guardia, ${nombre}. Podés ver tu estado en la pantalla de la sala de espera.`;
      p.focus();
    };

    goTo('stepResultado');
  });
})();
