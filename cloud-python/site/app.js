/* Nickland Edusoft — the public website.
 *
 * Plain JavaScript, no build step, no framework. The school application is a
 * large Expo build that takes minutes to compile; a marketing site that needs
 * the same toolchain to fix a typo in the pricing copy is a marketing site
 * nobody fixes typos in.
 *
 * The one rule that matters here: NO PRICE IS IN THIS FILE. Every figure on the
 * pricing page, in the plan chooser and on the review screen comes from
 * /api/v1/public/plans, which is the same table the checkout, the invoice and
 * the Superadmin console read (§16). If a price ever appears as a literal
 * below, the pricing page and the invoice can disagree, and the school finds
 * out which one was wrong at the worst possible moment.
 */
(function () {
  'use strict';

  var PATHS = {
    '/': 'home', '/features': 'features', '/pricing': 'pricing', '/about': 'about',
    '/support': 'support', '/register': 'register', '/login': 'login'
  };

  // The site is served from the same origin as the API on a normal deployment,
  // and from /welcome on a single-hostname one. Either way the API is at the
  // root, so it is addressed absolutely and never relative to the page.
  var API = '/api/v1';

  var state = {
    config: null,
    plans: null,
    currency: 'GHS',
    roll: 200,
    chosenPlan: null,
    registration: null
  };

  // ── helpers ──────────────────────────────────────────────────────────────
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'class') node.className = attrs[key];
      else if (key === 'text') node.textContent = attrs[key];
      else if (key === 'html') node.innerHTML = attrs[key];
      else if (attrs[key] !== null && attrs[key] !== undefined) node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) {
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function money(amount, currency) {
    var value = Number(amount || 0);
    return (currency || state.currency) + ' ' +
      value.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function api(path, options) {
    return fetch(API + path, Object.assign({
      headers: { 'Content-Type': 'application/json' }
    }, options || {})).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        body.__status = response.status;
        return body;
      });
    });
  }

  function busy(button, on, label) {
    if (!button) return;
    if (on) {
      button.dataset.label = button.textContent;
      button.setAttribute('aria-disabled', 'true');
      button.textContent = '';
      button.appendChild(el('span', { class: 'spin' }));
      button.appendChild(document.createTextNode(' ' + (label || 'Working…')));
    } else {
      button.removeAttribute('aria-disabled');
      button.textContent = button.dataset.label || label || 'Continue';
    }
  }

  function showError(node, message) {
    if (!node) return;
    node.hidden = !message;
    node.textContent = message || '';
    if (message) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // ── routing ──────────────────────────────────────────────────────────────
  function routeFor(pathname) {
    var path = pathname.replace(/\/welcome(?=\/|$)/, '') || '/';
    if (path.length > 1) path = path.replace(/\/+$/, '') || '/';
    return PATHS[path] || '404';
  }

  function basePrefix() {
    // On a single-hostname deployment the site lives under /welcome, and every
    // internal link has to keep that prefix or it lands on the school app.
    return window.location.pathname.indexOf('/welcome') === 0 ? '/welcome' : '';
  }

  function go(path, replace) {
    var url = basePrefix() + (path === '/' ? '/' : path);
    if (replace) window.history.replaceState({}, '', url);
    else window.history.pushState({}, '', url);
    render();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function render() {
    var route = routeFor(window.location.pathname);
    $$('[data-route]').forEach(function (node) {
      node.hidden = node.getAttribute('data-route') !== route;
    });
    $$('[data-route-link]').forEach(function (link) {
      if (link.getAttribute('data-route-link') === route) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.title = titleFor(route);
    $('#nav').classList.remove('open');
    $('#menuBtn').setAttribute('aria-expanded', 'false');
    if (route === 'pricing') renderPlans();
    if (route === 'register') renderPlanChoices();
    observeReveals();
  }

  function titleFor(route) {
    var names = {
      home: 'Nickland Edusoft — school management for Ghanaian schools',
      features: 'Features — Nickland Edusoft',
      pricing: 'Pricing — Nickland Edusoft',
      about: 'About — Nickland Edusoft',
      support: 'Support — Nickland Edusoft',
      register: 'Register your school — Nickland Edusoft',
      login: 'Sign in — Nickland Edusoft',
      '404': 'Not found — Nickland Edusoft'
    };
    return names[route] || names.home;
  }

  document.addEventListener('click', function (event) {
    var link = event.target.closest('a[data-link]');
    if (!link) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    go(link.getAttribute('href'));
  });

  window.addEventListener('popstate', render);

  // ── configuration and plans ──────────────────────────────────────────────
  function loadConfig() {
    return api('/public/config').then(function (config) {
      if (!config || !config.ok) return;
      state.config = config;
      state.currency = config.currency || 'GHS';
      // Painted as soon as the config lands, not only when somebody reaches
      // the last step of registration: the question "what can we pay with"
      // is asked on the pricing page, by somebody who has not registered.
      paintAccepted();
      $$('[data-currency]').forEach(function (n) { n.textContent = state.currency; });
      $$('[data-company]').forEach(function (n) { n.textContent = config.company_name || 'Nickland Sales'; });
      if (config.support_email) {
        $$('[data-support-email]').forEach(function (n) {
          n.textContent = config.support_email;
          n.setAttribute('href', 'mailto:' + config.support_email);
        });
      }
      if (config.support_phone) {
        $$('[data-support-phone]').forEach(function (n) { n.textContent = config.support_phone; });
        $$('[data-support-phone-link]').forEach(function (n) {
          n.hidden = false;
          n.textContent = config.support_phone;
          n.setAttribute('href', 'tel:' + config.support_phone.replace(/[^\d+]/g, ''));
        });
      }
      var copyright = $('[data-copyright]');
      if (copyright) {
        copyright.textContent = '© ' + new Date().getFullYear() + ' ' +
          (config.company_name || 'Nickland Sales') + '. All rights reserved.';
      }
      if (config.trial_enabled === false) {
        $$('[data-trial-note]').forEach(function (n) {
          n.textContent = 'No installation, nothing to buy first.';
        });
      }
    }).catch(function () { /* the page still reads without it */ });
  }

  function loadPlans(roll) {
    var query = roll ? ('?students=' + encodeURIComponent(roll)) : '';
    return api('/public/plans' + query).then(function (data) {
      if (!data || !data.ok) throw new Error('plans');
      state.plans = data.plans || [];
      state.currency = data.currency || state.currency;
      if (!state.chosenPlan) {
        // The plan a school lands on by default: the middle one if there are
        // three, which is the one most schools want and the one the pricing
        // page marks. Never hard-coded to an id — a platform with two plans or
        // five must still open on something sensible.
        var payable = state.plans.filter(function (p) { return p.is_public; });
        state.chosenPlan = (payable[Math.min(1, payable.length - 1)] || payable[0] || {}).plan_id;
      }
      return state.plans;
    });
  }

  // ── the pricing page ─────────────────────────────────────────────────────
  function renderPlans() {
    var host = $('[data-plans]');
    if (!host) return;
    var roll = Number($('#rollInput') && $('#rollInput').value) || 0;
    state.roll = roll;

    loadPlans(roll).then(function (plans) {
      host.innerHTML = '';
      var featuredIndex = Math.min(1, plans.length - 1);
      plans.forEach(function (plan, index) {
        host.appendChild(planCard(plan, index === featuredIndex, roll));
      });

      var note = $('[data-estimate-note]');
      if (note) {
        note.textContent = roll
          ? 'Showing what ' + roll.toLocaleString('en-GH') + ' pupils would cost on each plan.'
          : 'Enter your roll to see what each plan would cost.';
      }
      var tax = $('[data-tax-note]');
      if (tax && state.config) {
        tax.textContent = state.config.tax_rate
          ? 'Prices exclude ' + state.config.tax_label + ' at ' + state.config.tax_rate + '%.'
          : 'Prices are what you pay. Billing is monthly, and you can change plan or stop at any time.';
      }
      observeReveals();
    }).catch(function () {
      host.innerHTML = '';
      host.appendChild(el('div', {
        class: 'plan',
        html: '<p class="note bad">The prices could not be loaded just now. ' +
              'Please refresh, or write to us and we will send them to you.</p>'
      }));
    });
  }

  function planCard(plan, featured, roll) {
    var estimate = plan.estimate;
    var card = el('div', { class: 'plan' + (featured ? ' featured' : '') });

    if (featured) card.appendChild(el('span', { class: 'plan-badge', text: 'Most schools' }));
    card.appendChild(el('h3', { class: 'plan-name', text: plan.name }));
    card.appendChild(el('p', { class: 'plan-tagline', text: plan.tagline || plan.description || '' }));

    var price = el('div', { class: 'plan-price' });
    if (Number(plan.price_per_student) > 0) {
      price.appendChild(el('span', { class: 'amount', text: money(plan.price_per_student) }));
      price.appendChild(el('span', { class: 'unit', text: 'per pupil, ' + plan.interval_label }));
    } else if (Number(plan.base_price) > 0) {
      price.appendChild(el('span', { class: 'amount', text: money(plan.base_price) }));
      price.appendChild(el('span', { class: 'unit', text: plan.interval_label }));
    } else {
      price.appendChild(el('span', { class: 'amount', text: 'Free' }));
      price.appendChild(el('span', {
        class: 'unit',
        text: plan.trial_days ? 'for ' + plan.trial_days + ' days' : ''
      }));
    }
    card.appendChild(price);

    var sub = el('p', { class: 'plan-sub' });
    if (estimate && roll) {
      sub.textContent = estimate.over_limit
        ? 'Limited to ' + plan.max_students + ' pupils — your roll is above it.'
        : money(estimate.total_amount) + ' ' + plan.interval_label + ' for ' +
          roll.toLocaleString('en-GH') + ' pupils';
    } else if (plan.max_students) {
      sub.textContent = 'Up to ' + Number(plan.max_students).toLocaleString('en-GH') + ' pupils.';
    } else {
      sub.textContent = 'No limit on pupils.';
    }
    card.appendChild(sub);

    var cta = el('a', {
      class: 'btn ' + (featured ? 'btn-primary' : 'btn-outline'),
      href: '/register'
    }, [plan.trial_enabled && plan.trial_days ? 'Start a ' + plan.trial_days + '-day trial' : 'Choose ' + plan.name]);
    cta.setAttribute('data-link', '');
    cta.addEventListener('click', function () { state.chosenPlan = plan.plan_id; });
    card.appendChild(cta);

    var list = el('ul', { class: 'plan-features' });
    (state.featureCatalogue || []).forEach(function (feature) {
      var on = plan.features && plan.features[feature.feature_key];
      list.appendChild(el('li', { class: on ? '' : 'off', text: feature.name }));
    });
    card.appendChild(list);
    return card;
  }

  // ── the features page and the home grid ──────────────────────────────────
  function renderFeatures(features) {
    state.featureCatalogue = features;

    var home = $('[data-feature-grid]');
    if (home) {
      home.innerHTML = '';
      features.slice(0, 8).forEach(function (feature) {
        home.appendChild(el('div', { class: 'feature reveal' }, [
          el('h3', { text: feature.name }),
          el('p', { text: feature.description })
        ]));
      });
    }

    var full = $('[data-features-full]');
    if (full) {
      full.innerHTML = '';
      var groups = {};
      features.forEach(function (feature) {
        (groups[feature.category] = groups[feature.category] || []).push(feature);
      });
      Object.keys(groups).forEach(function (category) {
        full.appendChild(el('p', { class: 'eyebrow', text: category }));
        var grid = el('div', { class: 'grid g3', style: 'margin-bottom:44px' });
        groups[category].forEach(function (feature) {
          grid.appendChild(el('div', { class: 'card flat reveal' }, [
            el('h3', { text: feature.name }),
            el('p', { class: 'muted small', text: feature.description })
          ]));
        });
        full.appendChild(grid);
      });
    }
    observeReveals();
  }

  // ── registration ─────────────────────────────────────────────────────────
  function step(n) {
    $$('[data-pane]').forEach(function (pane) {
      pane.hidden = Number(pane.getAttribute('data-pane')) !== n;
    });
    $$('#regSteps .step').forEach(function (node) {
      var index = Number(node.getAttribute('data-step'));
      node.setAttribute('data-state', index === n ? 'current' : (index < n ? 'done' : 'todo'));
    });
    showError($('#regError'), '');
    if (n === 3) renderPlanChoices();
    if (n === 4) renderReview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function regValues() {
    var form = $('#regForm');
    if (!form) return {};
    return {
      school_name: form.school_name.value.trim(),
      phone: form.phone.value.trim(),
      region: form.region.value.trim(),
      students: Number(form.students.value) || 0,
      full_name: form.full_name.value.trim(),
      email: form.email.value.trim(),
      password: form.password.value,
      username: form.username.value.trim(),
      plan_id: state.chosenPlan
    };
  }

  function validateStep(n) {
    var values = regValues();
    if (n === 1) {
      if (values.school_name.length < 3) return 'Enter the school’s name.';
    }
    if (n === 2) {
      if (!values.full_name) return 'Enter your name.';
      if (!/^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/.test(values.email)) return 'Enter a valid email address.';
      if (values.password.length < 8) return 'Choose a password of at least 8 characters.';
      if (values.password !== $('#adminPassword2').value) return 'The two passwords do not match.';
    }
    if (n === 3 && !state.chosenPlan) return 'Choose a plan.';
    return null;
  }

  function renderPlanChoices() {
    var host = $('[data-plan-choices]');
    if (!host) return;
    var roll = Number($('#schoolRoll') && $('#schoolRoll').value) || 0;
    loadPlans(roll).then(function (plans) {
      host.innerHTML = '';
      plans.forEach(function (plan) {
        var chosen = plan.plan_id === state.chosenPlan;
        var card = el('button', {
          type: 'button',
          class: 'card flat',
          style: 'text-align:left;cursor:pointer;font:inherit;border-width:' +
                 (chosen ? '2px' : '1px') + ';border-color:' +
                 (chosen ? 'var(--royal)' : 'var(--line)') +
                 ';background:' + (chosen ? 'var(--royal-tint)' : 'var(--paper)'),
          'aria-pressed': chosen ? 'true' : 'false'
        });
        card.appendChild(el('h3', { text: plan.name, style: 'margin-bottom:2px' }));
        card.appendChild(el('p', {
          class: 'muted small', style: 'margin-bottom:12px',
          text: plan.tagline || ''
        }));
        card.appendChild(el('p', {
          style: 'font-size:1.3rem;font-weight:700;margin:0',
          text: plan.estimate ? money(plan.estimate.total_amount) : money(plan.price_per_student)
        }));
        card.appendChild(el('p', {
          class: 'muted small', style: 'margin:2px 0 0',
          text: plan.estimate
            ? plan.interval_label + ' for ' + roll + ' pupils'
            : 'per pupil, ' + plan.interval_label
        }));
        if (plan.trial_enabled && plan.trial_days) {
          card.appendChild(el('p', {
            class: 'small', style: 'margin:10px 0 0;color:var(--good)',
            text: plan.trial_days + ' days free first'
          }));
        }
        card.addEventListener('click', function () {
          state.chosenPlan = plan.plan_id;
          renderPlanChoices();
        });
        host.appendChild(card);
      });
    });
  }

  function renderReview() {
    var host = $('[data-review]');
    if (!host) return;
    var values = regValues();
    var plan = (state.plans || []).filter(function (p) { return p.plan_id === values.plan_id; })[0] || {};
    var estimate = plan.estimate;

    host.innerHTML = '';
    [
      ['School', values.school_name],
      ['Administrator', values.full_name],
      ['Sign in with', values.email],
      ['Plan', plan.name || values.plan_id],
      ['Pupils (estimated)', String(values.students)],
      ['Price per pupil', Number(plan.price_per_student) ? money(plan.price_per_student) : '—']
    ].forEach(function (pair) {
      host.appendChild(el('div', { class: 'row' }, [
        el('span', { class: 'k', text: pair[0] }),
        el('span', { class: 'v', text: pair[1] || '—' })
      ]));
    });

    if (plan.trial_enabled && plan.trial_days) {
      host.appendChild(el('div', { class: 'row credit' }, [
        el('span', { class: 'k', text: 'Free trial' }),
        el('span', { class: 'v', text: plan.trial_days + ' days' })
      ]));
      host.appendChild(el('div', { class: 'row total' }, [
        el('span', { class: 'k', text: 'Due today' }),
        el('span', { class: 'v', text: money(0) })
      ]));
      host.appendChild(el('div', { class: 'row' }, [
        el('span', { class: 'k', text: 'Then, each month' }),
        el('span', { class: 'v', text: estimate ? money(estimate.total_amount) : '—' })
      ]));
    } else {
      host.appendChild(el('div', { class: 'row total' }, [
        el('span', { class: 'k', text: 'Each month' }),
        el('span', { class: 'v', text: estimate ? money(estimate.total_amount) : money(0) })
      ]));
    }

    var note = $('[data-payment-note]');
    if (note) {
      var payments = state.config && state.config.payments;
      if (payments && payments.available) {
        note.textContent = plan.trial_days
          ? 'After your school is created you will be asked for a card. ' +
            'Nothing is charged during the trial — the card is only checked, so ' +
            'that your subscription can continue when the trial ends.'
          : 'After your school is created you will be taken to the payment page.';
      } else {
        note.textContent = 'Your school will be created and your trial started. ' +
          'We will be in touch about payment before it ends.';
      }
    }
    paintAccepted();
  }

  // What this deployment's gateway actually takes, in the school's words.
  // Printed from the provider rather than written into the page: a deployment
  // that moves from Paystack to Flutterwave must not leave a page promising
  // Verve to schools whose gateway has never heard of it.
  var BRANDS = { visa: 'Visa', mastercard: 'Mastercard', verve: 'Verve',
                 amex: 'American Express' };

  function acceptedCards() {
    var payments = state.config && state.config.payments;
    if (!payments || !payments.available) return '';
    var brands = (payments.card_brands || []).map(function (b) {
      return BRANDS[b] || (b.charAt(0).toUpperCase() + b.slice(1));
    });
    if (!brands.length) return '';
    return brands.length === 1 ? brands[0]
      : brands.slice(0, -1).join(', ') + ' and ' + brands[brands.length - 1];
  }

  function paintAccepted() {
    var cards = acceptedCards();
    var payments = state.config && state.config.payments;
    var momo = payments && (payments.channels || []).indexOf('mobile_money') >= 0;

    var inline = $('[data-accepts-note]');
    if (inline) {
      inline.textContent = cards
        ? '(' + cards + (momo ? ', and mobile money' : '') + ')' : '';
    }

    var host = $('[data-accepted-cards]');
    if (!host) return;
    if (!cards) { host.hidden = true; return; }
    host.hidden = false;
    // Said plainly, because the commonest question at this step is "will my
    // card work" and the second commonest is "why can I not use MoMo here".
    host.textContent = 'We accept ' + cards + '.'
      + (momo ? ' Mobile money is accepted for one-off invoices; the card step above '
              + 'asks for a card because that is what a renewing subscription can '
              + 'be charged to.' : '');
  }

  function submitRegistration(event) {
    event.preventDefault();
    for (var n = 1; n <= 3; n++) {
      var problem = validateStep(n);
      if (problem) { step(n); showError($('#regError'), problem); return; }
    }
    var button = $('#regSubmit');
    busy(button, true, 'Creating your school…');
    api('/public/register', {
      method: 'POST',
      body: JSON.stringify(regValues())
    }).then(function (result) {
      busy(button, false, 'Create my school');
      if (!result.ok) {
        showError($('#regError'), result.error || 'That did not work. Please check and try again.');
        return;
      }
      state.registration = result;
      renderDone(result);
      step(5);
      $$('#regSteps .step').forEach(function (node) { node.setAttribute('data-state', 'done'); });
      $('#regForm').hidden = true;
    }).catch(function () {
      busy(button, false, 'Create my school');
      showError($('#regError'), 'We could not reach the service. Check your connection and try again.');
    });
  }

  function renderDone(result) {
    var message = $('[data-done-message]');
    if (message) {
      message.textContent = result.trial
        ? 'Your ' + (result.plan ? result.plan.name : '') + ' trial has started' +
          (result.trial_ends_at ? ' and runs until ' + niceDate(result.trial_ends_at) : '') +
          '. Open your school and start adding your classes and pupils.'
        : 'Your subscription is active. Open your school and start adding your classes and pupils.';
    }

    var details = $('[data-done-details]');
    if (details) {
      details.innerHTML = '';
      [
        ['School', (result.school && result.school.name) || ''],
        ['Sign in with', result.administrator ? result.administrator.email : ''],
        ['Username', result.administrator ? result.administrator.username : ''],
        ['Your address', result.portal_host || 'this site'],
        ['Sync key', result.sync_key || '—']
      ].forEach(function (pair) {
        details.appendChild(el('div', { class: 'row' }, [
          el('span', { class: 'k', text: pair[0] }),
          el('span', { class: 'v', style: 'word-break:break-all', text: pair[1] || '—' })
        ]));
      });
    }

    var link = $('[data-app-link]');
    if (link) {
      // The token the registration issued is carried across so the school lands
      // signed in — one account, one sign-in, no second password box (§17).
      var target = result.app_url || '/app';
      if (result.token) {
        target += (target.indexOf('?') >= 0 ? '&' : '?') + 'token=' +
          encodeURIComponent(result.token) + '&school=' + encodeURIComponent(result.school_id);
      }
      link.setAttribute('href', target);
    }
  }

  function niceDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('en-GH', {
        day: 'numeric', month: 'long', year: 'numeric'
      });
    } catch (error) { return String(iso).slice(0, 10); }
  }

  // ── sign in ──────────────────────────────────────────────────────────────
  function submitLogin(event) {
    event.preventDefault();
    var button = $('#loginSubmit');
    var chooser = $('#loginSchool');
    var body = {
      email: $('#loginEmail').value.trim(),
      password: $('#loginPassword').value
    };
    if (!$('#loginChoose').hidden && chooser.value) body.school_id = chooser.value;

    busy(button, true, 'Signing in…');
    showError($('#loginError'), '');
    api('/public/login', { method: 'POST', body: JSON.stringify(body) })
      .then(function (result) {
        busy(button, false, 'Sign in');
        if (result.choose) {
          $('#loginChoose').hidden = false;
          chooser.innerHTML = '';
          (result.schools || []).forEach(function (school) {
            chooser.appendChild(el('option', { value: school.school_id, text: school.name }));
          });
          return;
        }
        if (!result.ok) {
          showError($('#loginError'), result.error || 'Those details did not match an account.');
          return;
        }
        var target = result.app_url || '/app';
        target += (target.indexOf('?') >= 0 ? '&' : '?') + 'token=' +
          encodeURIComponent(result.token) + '&school=' + encodeURIComponent(result.school_id);
        window.location.href = target;
      })
      .catch(function () {
        busy(button, false, 'Sign in');
        showError($('#loginError'), 'We could not reach the service. Check your connection and try again.');
      });
  }

  // ── reveal on scroll ─────────────────────────────────────────────────────
  var observer = null;
  function observeReveals() {
    if (!('IntersectionObserver' in window) ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      $$('.reveal').forEach(function (node) { node.classList.add('in'); });
      return;
    }
    if (!observer) {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            observer.unobserve(entry.target);
          }
        });
      }, { rootMargin: '0px 0px -8% 0px' });
    }
    $$('.reveal:not(.in)').forEach(function (node) { observer.observe(node); });

    // A backstop, and the reason for it: everything with `.reveal` starts at
    // zero opacity, so anything the observer never fires for is permanently
    // invisible rather than merely un-animated. That has happened — content
    // inside a route that was hidden when the observer was attached. Three
    // seconds is long enough for the animation to be the thing a reader sees,
    // and short enough that a failure is a missing animation and not a missing
    // page.
    clearTimeout(observeReveals._backstop);
    observeReveals._backstop = setTimeout(function () {
      $$('.reveal:not(.in)').forEach(function (node) { node.classList.add('in'); });
    }, 3000);
  }

  // ── wiring ───────────────────────────────────────────────────────────────
  function start() {
    $('#menuBtn').addEventListener('click', function () {
      var nav = $('#nav');
      var open = nav.classList.toggle('open');
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    $$('[data-next]').forEach(function (button) {
      button.addEventListener('click', function () {
        var next = Number(button.getAttribute('data-next'));
        var problem = validateStep(next - 1);
        if (problem) { showError($('#regError'), problem); return; }
        step(next);
      });
    });
    $$('[data-back]').forEach(function (button) {
      button.addEventListener('click', function () { step(Number(button.getAttribute('data-back'))); });
    });

    var regForm = $('#regForm');
    if (regForm) regForm.addEventListener('submit', submitRegistration);
    var loginForm = $('#loginForm');
    if (loginForm) loginForm.addEventListener('submit', submitLogin);

    var roll = $('#rollInput');
    if (roll) {
      var timer = null;
      roll.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(renderPlans, 250);
      });
    }

    step(1);
    loadConfig();
    // The feature catalogue comes back with the plans, and both pages need it,
    // so it is fetched once here rather than per page.
    api('/public/plans').then(function (data) {
      if (data && data.ok) {
        state.plans = data.plans || [];
        state.currency = data.currency || state.currency;
        renderFeatures(data.features || []);
        render();
      }
    }).catch(function () { /* the static copy still reads */ });

    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
