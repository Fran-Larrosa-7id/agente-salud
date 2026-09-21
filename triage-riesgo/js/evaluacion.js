(function () {
  const steps = ['stepNombre', 'stepMotivo', 'stepPreguntas', 'stepIntensidad', 'stepResultado'];
  let nombre = '';
  let motivoKey = null;
  let respuestas = [];
  let currentStep = 'stepNombre';

  let joined = false;

  function goTo(id) {
    currentStep = id;
    steps.forEach((s) => { document.getElementById(s).hidden = s !== id; });
    const idx = steps.indexOf(id);
    const nPaso = Math.min(idx + 1, 4);
    document.getElementById('stepCount').textContent = id === 'stepResultado' ? 'Resultado' : 'Paso ' + nPaso + ' de 4';
    document.querySelectorAll('#trProgress span').forEach((s, i) => s.classList.toggle('is-done', i < (id === 'stepResultado' ? 4 : idx + 1)));
    document.getElementById('btnAtras').hidden = idx === 0 || (id === 'stepResultado' && joined);
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    const heading = document.querySelector('#' + id + ' h1');
    if (heading) { heading.setAttribute('tabindex', '-1'); heading.focus(); }
  }

  document.getElementById('btnAtras').addEventListener('click', () => {
    const i = steps.indexOf(currentStep);
    if (i > 0) goTo(steps[i - 1]);
  });

  document.getElementById('formNombre').addEventListener('submit', (e) => {
    e.preventDefault();
    nombre = document.getElementById('inputNombre').value.trim() || 'Paciente';
    renderMotivos();
    goTo('stepMotivo');
  });

  function renderMotivos() {
    const cont = document.getElementById('motivosList');
    cont.innerHTML = Object.keys(TR_MOTIVOS).map((key) =>
      `<button class="tr-motivo-btn" data-motivo="${key}" type="button"><span>${TR_MOTIVOS[key].label}</span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg></button>`).join('');
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
  function etiquetaIntensidad(v) {
    if (v === 0) return 'Sin molestia';
    if (v <= 3) return 'Leve';
    if (v <= 6) return 'Moderado';
    if (v <= 8) return 'Intenso';
    return 'Muy intenso';
  }
  function actualizarIntensidad() {
    const v = Number(inputIntensidad.value);
    document.getElementById('intensidadValue').textContent = v;
    document.getElementById('intensidadLabel').textContent = etiquetaIntensidad(v);
  }
  inputIntensidad.addEventListener('input', actualizarIntensidad);
  actualizarIntensidad();

  document.getElementById('btnVerResultado').addEventListener('click', () => {
    const intensidad = Number(inputIntensidad.value);
    const { nivel, score } = trClasificar(motivoKey, respuestas, intensidad);

    const banner = document.getElementById('resultBanner');
    banner.className = 'tr-result-banner tr-bg-' + nivel.id;
    document.getElementById('resultNivel').innerHTML = `<svg class="tr-result-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg><span>${nivel.nombre}</span>`;
    document.getElementById('resultAccion').textContent = nivel.accion;
    document.getElementById('resultResumen').innerHTML = `
      <div><dt>Paciente</dt><dd>${nombre}</dd></div>
      <div><dt>Motivo</dt><dd>${TR_MOTIVOS[motivoKey].label}</dd></div>
      <div><dt>Intensidad</dt><dd>${intensidad}/10 · ${etiquetaIntensidad(intensidad)}</dd></div>`;

    document.getElementById('btnSumarCola').onclick = () => {
      const entrada = trAgregarACola(nombre, TR_MOTIVOS[motivoKey].label, nivel.id, score);
      joined = true;
      const miOrden = TR_NIVELES[entrada.nivelId].orden;
      const posicion = trGetState().cola.filter((p) => p.estado === 'esperando' && (TR_NIVELES[p.nivelId].orden < miOrden || (TR_NIVELES[p.nivelId].orden === miOrden && p.ts <= entrada.ts))).length;
      document.getElementById('btnSumarCola').hidden = true;
      document.getElementById('btnAtras').hidden = true;
      const box = document.getElementById('confirmacionCola');
      box.hidden = false;
      box.setAttribute('tabindex', '-1');
      box.innerHTML = `<div class="tr-queue-box-head">Estás en la cola de guardia</div>
        <div class="tr-queue-box-body">
          <div class="tr-queue-pos">${posicion}<small>${posicion === 1 ? 'sos el siguiente' : 'en la cola'}</small></div>
          <p class="tr-queue-note">Quedate en la sala de espera. Te llamamos por tu nombre, ${nombre}. La posición puede cambiar si llega un caso más urgente.</p>
        </div>`;
      box.focus();
      const links = document.createElement('div');
      links.className = 'tr-result-links';
      links.innerHTML = '<a class="btn btn-secondary" href="panel.html">Ver panel de guardia</a><a class="btn btn-ghost" href="evaluacion.html">Nueva evaluación</a>';
      box.after(links);
    };

    goTo('stepResultado');
  });
})();
