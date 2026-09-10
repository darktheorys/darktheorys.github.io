/**
 * Tori on a static page.
 *
 * Ported from the Retorio coach UI, minus everything that needed a running agent: no busy state, no
 * read-aloud, no pending question, no beer. What remains is the bird, its flight, and its perches.
 *
 * The original hunted perches among chat bubbles that moved on every scroll, so it re-measured once a
 * second and on every scroll frame. Here the perches are section rules in a document that does not
 * reflow while you read it, so measuring on load, on resize and after fonts land is enough.
 */
(function () {
  'use strict'

  /** The mascot's box, and where inside it the feet stand — 15.9 of 32 view units across, 27.4 down. */
  var SIZE = 112
  var FEET = 27.4 / 32
  var STANCE = 15.9 / 32

  /** How often it considers moving. It goes somewhere a few times a minute, it does not patrol. */
  var STEP_MS = 11000
  /** How far a perch may move under the bird before it takes off rather than riding along. */
  var JUMP = 40
  /** Past this, a pointer was dragging the bird rather than clicking it. */
  var DRAG_SLOP = 4

  /** One trip, beat by beat. The phase drives both the pose and which easing the position uses. */
  var FLIGHT = [
    { phase: 'crouch', ms: 150 },
    { phase: 'fly', ms: 430 },
    { phase: 'glide', ms: 400 },
    { phase: 'flare', ms: 190 },
    { phase: 'settle', ms: 320 },
  ]
  /** The last three beats: what an arrival looks like with no take-off in front of it. */
  var ARRIVAL = FLIGHT.slice(2)

  var COPY = {
    en: { nap: 'Tori is napping — click to wake', awake: 'Tori — click to send it for a nap' },
    de: { nap: 'Tori schläft — zum Aufwecken klicken', awake: 'Tori — zum Schlafen schicken' },
  }

  /* ---------------------------------------------------------------------------------------------
   * Tori's voice, synthesized rather than shipped.
   *
   * A recorded chirp would mean an asset to license, host and load before the one moment it is
   * needed. Two oscillator sweeps cost nothing: a bird's chirp is a fast rise-then-fall in pitch,
   * which is what a frequency ramp is.
   * ------------------------------------------------------------------------------------------ */

  /** Built on first use and kept: browsers cap how many audio contexts a page may open. */
  var audio = null
  var NOTES = [
    { at: 0, from: 2100, peak: 3300, to: 2500, ms: 80 },
    { at: 0.115, from: 2400, peak: 3600, to: 2900, ms: 60 },
  ]
  var PEAK = 0.055

  /** Silent wherever audio is unavailable: a page that throws because it could not chirp is worse. */
  function chirp() {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)()
      if (audio.state === 'suspended') audio.resume()

      NOTES.forEach(function (note) {
        var start = audio.currentTime + note.at
        var end = start + note.ms / 1000
        var mid = start + note.ms / 2000

        var osc = audio.createOscillator()
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(note.from, start)
        osc.frequency.exponentialRampToValueAtTime(note.peak, mid)
        osc.frequency.exponentialRampToValueAtTime(note.to, end)

        // Exponential both ways: a linear attack clicks and a linear release leaves an edge; it
        // cannot reach zero, hence the floor.
        var gain = audio.createGain()
        gain.gain.setValueAtTime(0.0001, start)
        gain.gain.exponentialRampToValueAtTime(PEAK, start + 0.012)
        gain.gain.exponentialRampToValueAtTime(0.0001, end)

        osc.connect(gain).connect(audio.destination)
        osc.start(start)
        osc.stop(end + 0.02)
      })
    } catch (e) {
      // No audio here. Nothing else about the page depends on it.
    }
  }

  /* ------------------------------------------------------------------------------------------ */

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value))
  }

  var main = document.querySelector('main')
  if (!main) return

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  var lang = (document.documentElement.lang || 'en').slice(0, 2)
  var copy = COPY[lang] || COPY.en

  var field = document.createElement('div')
  field.className = 'mascotField'

  var bot = document.createElement('button')
  bot.type = 'button'
  bot.className = 'mascotBot'
  bot.setAttribute('data-phase', 'circle')
  /**
   * A bird's body — and nothing else. Anything inside this box travels with it, which is why no perch
   * is drawn in here. The far wing exists only so a beat has something to counter: with one wing a flap
   * reads as a twitch. The head is one group hinged at the neck.
   */
  bot.innerHTML =
    '<svg viewBox="0 0 32 32" overflow="visible" aria-hidden="true">' +
    '<g class="birdFacing"><g class="birdBody">' +
    '<g class="birdTail"><path d="M9.4 18.6 L2.6 15.4 L4.2 21.6 Z" fill="var(--tori-accent)"/></g>' +
    '<g class="birdWingFar"><path d="M13 16.4 Q19 15 18.6 20.4 Q14 21 13 16.4 Z" fill="var(--tori-wing-far)"/></g>' +
    '<g class="birdLegs"><path d="M14.2 24.6V27.2M17.6 24.6V27.2" stroke="var(--tori-accent)" stroke-width="1.1" stroke-linecap="round" fill="none"/></g>' +
    '<ellipse cx="15.4" cy="19" rx="7" ry="6.4" fill="var(--tori-accent)"/>' +
    '<g class="birdWing"><path d="M12.4 16.6 Q18.4 17.4 17.2 22.6 Q13.2 22.4 12.4 16.6 Z" fill="var(--tori-eye)"/></g>' +
    '<g class="birdHead"><g class="birdNod">' +
    '<g class="birdCrest"><path d="M19.6 8.2 Q20.4 4.8 23.4 4.4" stroke="var(--tori-accent)" stroke-width="1.7" stroke-linecap="round" fill="none"/></g>' +
    '<circle cx="20.6" cy="12.4" r="5" fill="var(--tori-accent)"/>' +
    '<g class="birdBeak"><path d="M25.2 11.4 L29.2 12.9 L25.2 14.4 Z" fill="var(--tori-eye)"/></g>' +
    '<circle cx="21.8" cy="11.5" r="1.9" fill="#fff"/>' +
    '<g class="birdIris"><circle cx="22.1" cy="11.5" r="1" fill="var(--tori-eye)"/><circle cx="22.1" cy="11.5" r="0.45" fill="var(--tori-accent)"/></g>' +
    // Opacity-driven rather than a moving shape: at this size a 2px slide is invisible and a swap is not.
    '<path class="birdLid" d="M19.6 9.2H24V11.8Q21.8 12.6 19.6 11.8Z" fill="var(--tori-accent)" opacity="0"/>' +
    '</g></g>' +
    '</g></g></svg>'

  field.appendChild(bot)
  if (getComputedStyle(main).position === 'static') main.style.position = 'relative'
  main.appendChild(field)

  var pos = null
  var phase = 'circle'
  var spot = null
  var nap = false
  var carried = false
  var edges = []
  var timers = []
  var carry = null
  var grabbed = null

  function setPhase(next) {
    phase = next
    bot.setAttribute('data-phase', next)
  }

  function flag(name, on) {
    if (on) bot.setAttribute(name, '')
    else bot.removeAttribute(name)
  }

  function place(at) {
    if (!pos) return
    pos = at
    bot.style.left = at.x + 'px'
    bot.style.top = at.y + 'px'
  }

  function clearTimers() {
    timers.forEach(clearTimeout)
    timers = []
  }

  /**
   * Every edge the bird may stand on: the bottom border of each section rule, and the footer's top
   * border. Real horizontal lines already in the page, measured relative to the field's own top.
   */
  function measure() {
    var box = main.getBoundingClientRect()
    var found = []
    main.querySelectorAll('h2').forEach(function (h2, i) {
      var r = h2.getBoundingClientRect()
      found.push({ id: 'h2-' + i, y: r.bottom - box.top, from: r.left - box.left, to: r.right - box.left })
    })
    var foot = main.querySelector('footer')
    if (foot) {
      var f = foot.getBoundingClientRect()
      found.push({ id: 'footer', y: f.top - box.top, from: f.left - box.left, to: f.right - box.left })
    }
    // A bird needs its own height above an edge and its own width along it. Neither is a property of
    // the surface, which is why the test lives here rather than in the measuring.
    edges = found.filter(function (e) {
      return e.y >= FEET * SIZE && e.to - e.from >= SIZE
    })
  }

  /** The corner the bird needs so its feet land on that point of that edge, or null if it is gone. */
  function corner(want) {
    for (var i = 0; i < edges.length; i++) {
      if (edges[i].id !== want.id) continue
      var e = edges[i]
      return { x: e.from + want.at * (e.to - e.from) - STANCE * SIZE, y: e.y - FEET * SIZE }
    }
    return null
  }

  /** Walk a run of beats on a timer chain, moving the destination at the two points where it changes. */
  function fly(beats, to, from) {
    clearTimers()
    flag('data-flip', to.x < from.x)
    var elapsed = 0
    beats.forEach(function (beat) {
      var at = elapsed
      timers.push(
        setTimeout(function () {
          setPhase(beat.phase)
          // The climb goes to an apex above both ends; the glide brings it down onto the perch.
          if (beat.phase === 'fly') place({ x: to.x, y: Math.max(4, Math.min(from.y, to.y) - SIZE / 2) })
          if (beat.phase === 'glide') place(to)
        }, at)
      )
      elapsed += beat.ms
    })
    timers.push(
      setTimeout(function () {
        setPhase('perch')
        hop()
      }, elapsed)
    )
  }

  /** One hop, one chirp, one bar of song. A napping Tori stays quiet. */
  function hop() {
    flag('data-hop', true)
    setTimeout(function () {
      flag('data-hop', false)
    }, 700)
    if (nap || reduced.matches) return
    chirp()
    flag('data-singing', true)
    setTimeout(function () {
      flag('data-singing', false)
    }, 520)
  }

  /** Pick somewhere else that exists and go. */
  function leave() {
    if (!pos || !spot) return
    var open = edges.filter(function (e) {
      return e.id !== spot.id
    })
    if (!open.length) return
    var e = open[Math.floor(Math.random() * open.length)]
    // Never the ends of an edge, where half the bird would hang off its perch.
    var next = { id: e.id, at: 0.2 + Math.random() * 0.6 }
    var to = corner(next)
    if (!to) return
    spot = next
    fly(FLIGHT, to, pos)
  }

  function land() {
    measure()
    if (!edges.length) return
    var target = spot && corner(spot) ? spot : { id: edges[0].id, at: 0.72 }
    var to = corner(target)
    if (!to) return
    spot = target
    if (!pos) {
      // It starts in the air, not on the ground: a bird placed straight onto a perch has to be moved.
      var box = main.getBoundingClientRect()
      pos = { x: box.width * 0.68, y: Math.max(8, to.y - SIZE) }
      bot.style.left = pos.x + 'px'
      bot.style.top = pos.y + 'px'
    }
    fly(ARRIVAL, to, pos)
  }

  // Re-seat when the page reflows under it. A small move is ridden out; a large one is a relayout, and
  // snapping across that is what a teleport looked like.
  function reseat() {
    measure()
    if (phase !== 'perch' || carried || !spot || !pos) return
    var here = corner(spot)
    if (!here) {
      setPhase('circle')
      land()
      return
    }
    if (Math.abs(here.x - pos.x) > JUMP || Math.abs(here.y - pos.y) > JUMP) {
      setPhase('circle')
      fly(ARRIVAL, here, pos)
    } else {
      place(here)
    }
  }

  /* ---------- wiring ---------- */

  bot.title = copy.awake
  bot.setAttribute('aria-label', copy.awake)

  bot.addEventListener('pointerdown', function (event) {
    var box = main.getBoundingClientRect()
    if (!pos) return
    event.preventDefault()
    // Capture keeps the drag alive when the cursor outruns the bird. Not fatal if refused.
    try {
      bot.setPointerCapture(event.pointerId)
    } catch (e) {
      // Dragged without it; only the overshoot is lost.
    }
    clearTimers()
    carry = { x: event.clientX - box.left - pos.x, y: event.clientY - box.top - pos.y }
    grabbed = { x: event.clientX, y: event.clientY }
  })

  bot.addEventListener('pointermove', function (event) {
    if (!carry) return
    var box = main.getBoundingClientRect()
    if (!carried) {
      // Only past the slop, or every click to nap would also count as a one-pixel drag.
      if (grabbed && Math.hypot(event.clientX - grabbed.x, event.clientY - grabbed.y) < DRAG_SLOP) return
      carried = true
      flag('data-carried', true)
      setPhase('crouch')
    }
    place({
      x: clamp(event.clientX - box.left - carry.x, 0, box.width - SIZE),
      y: clamp(event.clientY - box.top - carry.y, 0, main.offsetHeight - SIZE),
    })
  })

  bot.addEventListener('pointerup', function (event) {
    var moved = grabbed && Math.hypot(event.clientX - grabbed.x, event.clientY - grabbed.y) >= DRAG_SLOP
    carry = null
    grabbed = null
    carried = false
    flag('data-carried', false)
    if (moved) {
      // Put down, not dropped: back into the air, and the landing machinery flies it to a perch.
      setPhase('circle')
      land()
      return
    }
    clearTimers()
    setPhase('perch')
    nap = !nap
    flag('data-nap', nap)
    bot.title = nap ? copy.nap : copy.awake
    bot.setAttribute('aria-label', nap ? copy.nap : copy.awake)
    if (!nap) hop()
  })

  // A touch scroll or a lost capture ends a drag without a pointerup, and refs left set stuck it carried.
  bot.addEventListener('pointercancel', function () {
    carry = null
    grabbed = null
    carried = false
    flag('data-carried', false)
    setPhase('circle')
    land()
  })

  // The eye follows the pointer through a CSS variable rather than state: a re-render per mouse move
  // would rebuild the whole figure for two pixels.
  if (!reduced.matches) {
    var queued = 0
    window.addEventListener(
      'mousemove',
      function (event) {
        if (queued || nap) return
        queued = requestAnimationFrame(function () {
          queued = 0
          var box = bot.getBoundingClientRect()
          if (!box.width) return
          var lean = function (v) {
            return clamp(v * 2, -1, 1).toFixed(2)
          }
          bot.style.setProperty('--tori-look-x', lean((event.clientX - (box.left + box.width / 2)) / box.width))
          bot.style.setProperty('--tori-look-y', lean((event.clientY - (box.top + box.height / 2)) / box.height))
        })
      },
      { passive: true }
    )

    setInterval(function () {
      // Holds still under the cursor or focus, and never sets off mid-trip, which would strand the chain.
      if (bot.matches(':hover, :focus-visible')) return
      if (nap || phase !== 'perch' || !pos) return
      // Not every tick: a mascot that moves on a metronome is a screensaver.
      if (Math.random() < 0.4) return
      leave()
    }, STEP_MS)
  }

  var pending = 0
  window.addEventListener('resize', function () {
    clearTimeout(pending)
    pending = setTimeout(reseat, 180)
  })

  land()
  // Web fonts land after first paint and move every heading, so the first measurement is provisional.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(reseat)
})()
