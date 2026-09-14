/* Nickland Edusoft — the Superadmin console.
 *
 * Plain JavaScript against /api/v1/admin. Every screen is a function that
 * fetches and renders; there is no framework and no build step, for the same
 * reason the website has none — this has to be editable by whoever is on call.
 *
 * Two things this file is careful about:
 *
 *   · **It renders what the API says, never what it assumes.** Plan names,
 *     feature keys, statuses and settings all come down the wire. There is no
 *     list of plans in here to go stale when an operator adds a fourth.
 *   · **Every destructive action states its consequence before it happens.**
 *     Suspending a school, revoking an exemption and voiding an invoice all ask
 *     first, in a sentence that says what will happen to the school.
 */
(function () {
  'use strict';

  var API = '/api/v1/admin';
  var TOKEN_KEY = 'edusoft.console.token';

  var state = { token: null, operator: null, page: 'dashboard', cache: {} };

  // ── helpers ──────────────────────────────────────────────────────────────
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function money(amount, currency) {
    return (currency || 'GHS') + ' ' + Number(amount || 0)
      .toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function count(n) { return Number(n || 0).toLocaleString('en-GH'); }
  function day(iso) { return iso ? String(iso).slice(0, 10) : '—'; }
  function when(iso) { return iso ? String(iso).slice(0, 16).replace('T', ' ') : '—'; }

  function api(path, options) {
    options = options || {};
    var headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    if (options.platformKey) headers['x-platform-key'] = options.platformKey;
    return fetch(API + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (response.status === 401 && state.token) signOut(true);
        body.__status = response.status;
        return body;
      });
    });
  }

  function toast(message, bad) {
    var node = $('#toast');
    node.textContent = message;
    node.className = 'toast in' + (bad ? ' bad' : '');
    clearTimeout(node._timer);
    node._timer = setTimeout(function () { node.className = 'toast' + (bad ? ' bad' : ''); }, 3200);
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
      button.textContent = button.dataset.label || label || 'Save';
    }
  }

  function fail(result) {
    toast((result && result.error) || 'That did not work.', true);
    return result;
  }

  function ok(result, message) {
    if (result && result.ok) { toast(message || 'Saved.'); return true; }
    fail(result);
    return false;
  }

  function statusTag(status, label) {
    var tone = {
      ACTIVE: 'good', TRIALING: 'info', PAST_DUE: 'warn', GRACE_PERIOD: 'warn',
      SUSPENDED: 'bad', CANCELLED: 'bad', TERMINATED: 'bad', NONE: ''
    }[status] || '';
    return el('span', { class: 'tag ' + tone, text: label || status || '—' });
  }

  function invoiceTag(status) {
    var tone = { PAID: 'good', EXEMPT: 'warn', OPEN: 'info', PAST_DUE: 'bad',
                 VOID: '', DRAFT: '' }[status] || '';
    return el('span', { class: 'tag ' + tone, text: status });
  }

  function table(columns, rows, options) {
    options = options || {};
    if (!rows.length) return el('div', { class: 'empty', text: options.empty || 'Nothing here yet.' });
    var head = el('tr', {}, columns.map(function (c) {
      return el('th', { class: c.num ? 'num' : '', text: c.label });
    }));
    var body = rows.map(function (row) {
      var tr = el('tr', options.onRow ? { class: 'clickable', onclick: function () { options.onRow(row); } } : {});
      columns.forEach(function (c) {
        var value = c.render ? c.render(row) : row[c.key];
        tr.appendChild(el('td', { class: c.num ? 'num' : '' },
          [typeof value === 'string' || typeof value === 'number' ? String(value) : (value || '—')]));
      });
      return tr;
    });
    return el('div', { class: 'table-scroll' }, [
      el('table', { class: options.matrix ? 'matrix' : '' }, [
        el('thead', {}, [head]), el('tbody', {}, body)
      ])
    ]);
  }

  function panel(title, body, actions) {
    return el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('h2', { text: title })].concat(actions || [])),
      el('div', { class: body._flush ? 'panel-body flush' : 'panel-body' }, [body])
    ]);
  }

  function flush(node) { node._flush = true; return node; }

  function field(label, input, hint) {
    return el('div', { class: 'field' }, [
      el('label', { text: label, for: input.id || null }), input,
      hint ? el('p', { class: 'hint', text: hint }) : null
    ]);
  }

  function input(attrs) { return el('input', attrs); }

  function select(attrs, options, value) {
    var node = el('select', attrs);
    options.forEach(function (option) {
      node.appendChild(el('option', {
        value: option.value,
        selected: String(option.value) === String(value) ? 'selected' : null,
        text: option.label
      }));
    });
    return node;
  }

  // ── sign in ──────────────────────────────────────────────────────────────
  function signIn(event) {
    event.preventDefault();
    var button = $('#signinSubmit');
    busy(button, true, 'Signing in…');
    api('/login', {
      method: 'POST',
      body: { email: $('#signinEmail').value.trim(), password: $('#signinPassword').value }
    }).then(function (result) {
      busy(button, false, 'Sign in');
      if (!result.ok) {
        $('#signinError').hidden = false;
        $('#signinError').textContent = result.__status === 404
          ? 'This service has no platform administration configured.'
          : (result.error || 'Those details did not match an account.');
        return;
      }
      state.token = result.token;
      state.operator = result.user;
      try { sessionStorage.setItem(TOKEN_KEY, result.token); } catch (e) { /* private window */ }
      enterConsole();
    }).catch(function () {
      busy(button, false, 'Sign in');
      $('#signinError').hidden = false;
      $('#signinError').textContent = 'The console could not reach the service.';
    });
  }

  function bootstrap(event) {
    event.preventDefault();
    var button = $('#bootstrapSubmit');
    busy(button, true, 'Creating…');
    api('/operators', {
      method: 'POST',
      platformKey: $('#bsKey').value.trim(),
      body: {
        email: $('#bsEmail').value.trim(), full_name: $('#bsName').value.trim(),
        password: $('#bsPassword').value, role: 'superadmin'
      }
    }).then(function (result) {
      busy(button, false, 'Create the account');
      if (!result.ok) {
        $('#signinError').hidden = false;
        $('#signinError').textContent = result.error || 'That did not work.';
        return;
      }
      $('#bootstrapForm').hidden = true;
      $('#signinError').hidden = true;
      $('#bootstrapNote').hidden = false;
      $('#bootstrapNote').textContent = 'Account created. Sign in with it below.';
      $('#signinEmail').value = $('#bsEmail').value.trim();
      $('#signinPassword').focus();
    });
  }

  function signOut(expired) {
    state.token = null;
    state.operator = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
    $('#consoleView').hidden = true;
    $('#signinView').hidden = false;
    if (expired) {
      $('#signinError').hidden = false;
      $('#signinError').textContent = 'That console session has ended. Sign in again.';
    }
  }

  function enterConsole() {
    $('#signinView').hidden = true;
    $('#consoleView').hidden = false;
    $('#whoName').textContent = (state.operator && (state.operator.full_name || state.operator.email)) || 'Operator';
    $('#whoRole').textContent = (state.operator && state.operator.role) || '';
    route();
  }

  // ── routing ──────────────────────────────────────────────────────────────
  var PAGES = {};

  function route() {
    var name = (window.location.hash || '#dashboard').slice(1).split('/')[0] || 'dashboard';
    if (!PAGES[name]) name = 'dashboard';
    state.page = name;
    $$('[data-nav]').forEach(function (link) {
      if (link.getAttribute('data-nav') === name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    $('#pageError').hidden = true;
    var host = $('#page');
    host.innerHTML = '';
    host.appendChild(el('p', { class: 'skeleton', style: 'height:7em', text: ' ' }));
    PAGES[name](host);
  }

  function show(host, nodes) {
    host.innerHTML = '';
    (Array.isArray(nodes) ? nodes : [nodes]).forEach(function (node) {
      if (node) host.appendChild(node);
    });
  }

  function head(title, subtitle, actions) {
    return el('div', { class: 'page-head' }, [
      el('div', {}, [
        el('h1', { text: title }),
        subtitle ? el('p', { class: 'muted', text: subtitle }) : null
      ]),
      el('div', { class: 'inline' }, actions || [])
    ]);
  }

  // ── dashboard ────────────────────────────────────────────────────────────
  PAGES.dashboard = function (host) {
    api('/dashboard').then(function (data) {
      if (!data.ok) return show(host, el('div', { class: 'note bad', text: data.error || 'Could not load.' }));
      var s = data.schools, r = data.revenue;
      $('[data-count="schools"]').textContent = s.total;

      var stats = el('div', { class: 'stats' }, [
        stat('Schools', count(s.total), s.incomplete ? s.incomplete + ' incomplete' : 'all complete'),
        stat('On trial', count(s.trialing), 'in their free period'),
        stat('Active', count(s.active), 'paying'),
        stat('Suspended', count(s.suspended), 'unpaid'),
        stat('Pupils billed', count(data.pupils), 'across the platform'),
        stat('Outstanding', money(r.outstanding), r.overdue_invoices + ' overdue')
      ]);

      var trials = data.trials_ending || [];
      var overdue = data.overdue || [];

      show(host, [
        head('Dashboard', 'Nickland Edusoft — the whole platform.', [
          el('button', {
            class: 'btn btn-outline', type: 'button',
            onclick: function (e) { runBilling(e.target); }
          }, ['Run billing now'])
        ]),
        stats,
        el('div', { class: 'grid2' }, [
          el('div', {}, [
            panel('Revenue this platform', waterfall(r)),
            panel('Overdue invoices', flush(table([
              { label: 'Invoice', key: 'invoice_number' },
              { label: 'School', key: 'school_name' },
              { label: 'Due', render: function (i) { return day(i.due_at); } },
              { label: 'Amount', num: true, render: function (i) { return money(i.total_amount, i.currency); } }
            ], overdue, { empty: 'Nothing is overdue.' })))
          ]),
          el('div', {}, [
            panel('Trials ending within a week', flush(table([
              { label: 'School', key: 'school_id' },
              { label: 'Plan', key: 'plan_id' },
              { label: 'Days', num: true, key: 'days_left' }
            ], trials, { empty: 'No trial ends this week.' }))),
            panel('Schools by plan', flush(table([
              { label: 'Plan', key: 'name' },
              { label: 'Schools', num: true, key: 'schools' }
            ], data.plans || []))),
            panel('Latest platform activity', flush(table([
              { label: 'When', render: function (a) { return when(a.at); } },
              { label: 'What', key: 'action' },
              { label: 'Detail', key: 'detail' }
            ], (data.recent || []).slice(0, 12), { empty: 'Nothing recorded yet.' })))
          ])
        ])
      ]);
    });
  };

  function stat(label, value, note) {
    return el('div', { class: 'stat' }, [
      el('div', { class: 'k', text: label }),
      el('div', { class: 'v', text: value }),
      note ? el('div', { class: 'n', text: note }) : null
    ]);
  }

  function waterfall(r) {
    // §27's waterfall, drawn as one. An exempt school must never be in the same
    // line as a school that has not paid, and the only way to guarantee a
    // reader sees that is to give the exemption its own step.
    return el('ul', { class: 'waterfall' }, [
      wf('Gross subscription value', money(r.gross)),
      wf('Discounts', '− ' + money(r.discounts), 'minus'),
      wf('Exemptions', '− ' + money(r.exemptions), 'exempt'),
      wf('Net billed', money(r.net_billed)),
      wf('Collected', money(r.collected), 'good'),
      wf('Outstanding', money(r.outstanding), 'final')
    ]);
  }

  function wf(step, amount, cls) {
    return el('li', { class: cls || '' }, [
      el('span', { class: 'step', text: step }),
      el('span', { class: 'amount', text: amount })
    ]);
  }

  function runBilling(button) {
    if (!confirm('Run the billing cycle now?\n\nTrials that have ended will move on, ' +
                 'invoices will be raised for periods that have closed, and overdue ' +
                 'invoices will be marked. Nothing is charged twice.')) return;
    busy(button, true, 'Running…');
    api('/billing-run', { method: 'POST', body: {} }).then(function (result) {
      busy(button, false, 'Run billing now');
      if (!result.ok) return fail(result);
      var report = result.report;
      toast(report.invoiced.length + ' invoiced, ' + report.exempt.length + ' exempt, ' +
            report.advanced.length + ' moved on' +
            (report.errors.length ? ', ' + report.errors.length + ' failed' : '') + '.');
      route();
    });
  }

  // ── schools ──────────────────────────────────────────────────────────────
  PAGES.schools = function (host) {
    api('/schools').then(function (data) {
      if (!data.ok) return show(host, el('div', { class: 'note bad', text: data.error }));
      var schools = data.schools || [];
      $('[data-count="schools"]').textContent = schools.length;

      var search = input({ type: 'text', placeholder: 'Find a school…', id: 'schoolSearch' });
      var body = el('div', {});

      function draw() {
        var needle = search.value.trim().toLowerCase();
        var rows = schools.filter(function (s) {
          return !needle || (s.name + ' ' + s.school_id).toLowerCase().indexOf(needle) >= 0;
        });
        show(body, panel('Schools (' + rows.length + ')', flush(table([
          { label: 'School', render: function (s) {
            return el('span', {}, [
              el('b', { text: s.name }),
              el('div', { class: 'small muted', text: s.school_id })
            ]);
          } },
          { label: 'Status', render: function (s) { return statusTag(s.status, s.status_label); } },
          { label: 'Plan', key: 'plan_id' },
          { label: 'Pupils', num: true, render: function (s) { return count(s.students); } },
          { label: 'Adjustments', render: function (s) {
            return el('span', {}, [
              s.has_discount ? el('span', { class: 'tag info', text: 'Discount' }) : null,
              s.is_exempt ? el('span', { class: 'tag warn', text: 'Exempt' }) : null,
              (!s.has_discount && !s.is_exempt) ? el('span', { class: 'muted small', text: '—' }) : null
            ]);
          } },
          { label: 'Outstanding', num: true, render: function (s) {
            return s.outstanding ? money(s.outstanding) : '—';
          } },
          { label: 'Health', render: function (s) {
            return s.complete
              ? el('span', { class: 'tag good', text: 'OK' })
              : el('span', { class: 'tag bad', title: s.problem || '', text: 'Incomplete' });
          } }
        ], rows, { onRow: function (s) { openSchool(s.school_id); },
                   empty: 'No school matches that.' }))));
      }

      search.addEventListener('input', draw);
      show(host, [
        head('Schools', 'Every school on the platform. Click one to open it.',
             [el('div', { class: 'field', style: 'min-width:240px' }, [search])]),
        body
      ]);
      draw();
    });
  };

  // ── one school (a drawer) ────────────────────────────────────────────────
  function openSchool(schoolId) {
    var backdrop = el('div', { class: 'drawer-backdrop', onclick: close });
    var drawer = el('div', { class: 'drawer', role: 'dialog', 'aria-label': 'School' });
    var body = el('div', { class: 'drawer-body' }, [el('p', { class: 'skeleton', style: 'height:8em', text: ' ' })]);
    var title = el('h2', { text: schoolId, style: 'margin:0' });
    drawer.appendChild(el('div', { class: 'drawer-head' }, [
      title, el('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: close }, ['Close'])
    ]));
    drawer.appendChild(body);
    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);
    requestAnimationFrame(function () { backdrop.classList.add('in'); drawer.classList.add('in'); });
    document.addEventListener('keydown', onKey);

    function onKey(e) { if (e.key === 'Escape') close(); }
    function close() {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      drawer.remove();
    }

    function reload() {
      api('/schools/' + encodeURIComponent(schoolId)).then(function (data) {
        if (!data.ok) { body.innerHTML = ''; body.appendChild(el('div', { class: 'note bad', text: data.error })); return; }
        title.textContent = data.school.name;
        drawSchool(body, data, reload, close);
      });
    }
    reload();
  }

  function drawSchool(body, data, reload, close) {
    var school = data.school, sub = data.subscription, quote = data.quote;
    var tabs = ['Overview', 'Billing', 'Adjustments', 'Invoices', 'History'];
    var current = 'Overview';
    var panes = el('div', {});

    var tabBar = el('div', { class: 'drawer-tabs' }, tabs.map(function (name) {
      return el('button', {
        type: 'button', 'aria-selected': name === current ? 'true' : 'false',
        onclick: function () {
          current = name;
          $$('button', tabBar).forEach(function (b) {
            b.setAttribute('aria-selected', b.textContent === name ? 'true' : 'false');
          });
          drawPane();
        }
      }, [name]);
    }));

    function drawPane() {
      panes.innerHTML = '';
      if (current === 'Overview') panes.appendChild(overviewPane());
      if (current === 'Billing') panes.appendChild(billingPane());
      if (current === 'Adjustments') panes.appendChild(adjustmentsPane());
      if (current === 'Invoices') panes.appendChild(invoicesPane());
      if (current === 'History') panes.appendChild(historyPane());
    }

    function overviewPane() {
      var rows = el('div', { class: 'rows' }, [
        detail('Tenant id', school.school_id),
        detail('Status', sub ? (data.status_label + ' — ' + sub.status) : 'No subscription'),
        detail('Plan', data.plan ? data.plan.name : '—'),
        detail('Pupils billed', count(data.usage.billable_students) +
               ' of ' + count(data.usage.total_students) + ' (' + data.usage.source + ')'),
        detail('Trial ends', sub && sub.trial_ends_at ? day(sub.trial_ends_at) : '—'),
        detail('Next bill', sub && sub.current_period_end ? day(sub.current_period_end) : '—'),
        detail('Address', (data.portal_hosts || []).join(', ') || '—'),
        detail('Administrators', (data.administrators || []).map(function (a) { return a.email; }).join(', ') || '—'),
        detail('Database', school.has_database ? 'present' : 'MISSING'),
        detail('Enrolled', school.enrolled ? 'yes' : 'no')
      ]);

      var actions = el('div', { class: 'inline', style: 'margin-top:8px' }, [
        el('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: function () {
          lifecycle('suspend', 'Suspend this school?\n\nStaff will be limited to reading their ' +
                    'own records until the bill is settled. Nothing is deleted.');
        } }, ['Suspend']),
        el('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: function () {
          lifecycle('reactivate', 'Restore this school to full access?');
        } }, ['Reactivate']),
        el('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: function () {
          lifecycle('archive', 'Archive this school?\n\nIts subscription is closed and staff ' +
                    'can no longer sign in. Its database is kept — nothing is deleted here.');
        } }, ['Archive']),
        el('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: function (e) {
          if (!confirm('Issue a new sync key for this school?\n\nThe key its desktop is ' +
                       'using now will stop working immediately. Tell the school first.')) return;
          busy(e.target, true, 'Issuing…');
          api('/schools/' + encodeURIComponent(school.school_id) + '/rotate-key', { method: 'POST' })
            .then(function (result) {
              busy(e.target, false, 'New sync key');
              if (result.ok) alert('New sync key — shown once:\n\n' + result.api_key);
              else fail(result);
            });
        } }, ['New sync key'])
      ]);

      var problem = school.problem
        ? el('div', { class: 'note bad', text: school.problem }) : null;
      var notice = data.entitlement && data.entitlement.notice
        ? el('div', { class: 'note ' + (data.entitlement.notice_level === 'blocked' ? 'bad' :
                       data.entitlement.notice_level === 'warn' ? 'warn' : ''),
                      text: data.entitlement.notice }) : null;

      return el('div', {}, [problem, notice, panel('The school', rows), actions]);
    }

    function billingPane() {
      var lines = el('div', { class: 'rows' }, (data.lines || []).map(function (line) {
        return el('div', { class: 'row' + (line.amount < 0 ? ' credit' : '') }, [
          el('span', { class: 'k', text: line.description }),
          el('span', { class: 'v', text: money(line.amount, quote && quote.currency) })
        ]);
      }).concat(quote ? [el('div', { class: 'row total' }, [
        el('span', { class: 'k', text: 'Each ' + (quote.billing_interval === 'annual' ? 'year' :
                                                  quote.billing_interval === 'termly' ? 'term' : 'month') }),
        el('span', { class: 'v', text: money(quote.total_amount, quote.currency) })
      ])] : []));

      var planOptions = (state.cache.plans || []).map(function (p) {
        return { value: p.plan_id, label: p.name };
      });
      var planPicker = select({ id: 'schoolPlan' }, planOptions, sub && sub.plan_id);
      var statusPicker = select({ id: 'schoolStatus' }, [
        'TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'SUSPENDED', 'CANCELLED', 'TERMINATED'
      ].map(function (s) { return { value: s, label: s }; }), sub && sub.status);
      var reason = input({ type: 'text', placeholder: 'Why (goes on the record)' });

      var controls = el('div', {}, [
        field('Plan', planPicker),
        el('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: function (e) {
          act(e.target, { action: sub ? 'plan' : 'subscribe', plan_id: planPicker.value,
                          reason: reason.value });
        } }, [sub ? 'Change plan' : 'Subscribe']),
        el('hr', { style: 'margin:18px 0;border:0;border-top:1px solid var(--line)' }),
        field('Negotiated price per pupil', input({
          type: 'number', step: '0.01', min: '0', id: 'priceOverride',
          value: sub && sub.price_per_student_override !== null && sub.price_per_student_override !== undefined
            ? sub.price_per_student_override : ''
        }), 'Leave blank to use the plan’s own price. This school only — the plan is untouched.'),
        el('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: function (e) {
          act(e.target, { action: 'price', price_per_student: $('#priceOverride').value,
                          reason: reason.value });
        } }, ['Set price']),
        el('hr', { style: 'margin:18px 0;border:0;border-top:1px solid var(--line)' }),
        field('Override status', statusPicker,
              'A manual override. It is written to the audit trail with your name on it.'),
        field('Reason', reason),
        el('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: function (e) {
          if (!reason.value.trim()) { toast('Say why — an override without a reason is not allowed.', true); return; }
          act(e.target, { action: 'status', status: statusPicker.value, reason: reason.value });
        } }, ['Apply override'])
      ]);

      return el('div', {}, [
        panel('What this school pays', lines),
        panel('Subscription', controls),
        panel('Payment methods', flush(table([
          { label: 'Kind', key: 'kind' },
          { label: 'Brand', key: 'brand' },
          { label: 'Last 4', key: 'last4' },
          { label: 'Expires', render: function (m) {
            return m.exp_month ? m.exp_month + '/' + m.exp_year : '—'; } }
        ], data.payment_methods || [], { empty: 'No card on file.' })))
      ]);
    }

    function adjustmentsPane() {
      var kind = select({ id: 'dKind' }, [
        { value: 'percent', label: 'Percentage' }, { value: 'fixed', label: 'Fixed amount' }
      ]);
      var value = input({ type: 'number', step: '0.01', min: '0', id: 'dValue' });
      var label = input({ type: 'text', id: 'dLabel', placeholder: 'Founding school' });
      var cycles = input({ type: 'number', min: '1', id: 'dCycles', placeholder: 'every cycle' });
      var ends = input({ type: 'date', id: 'dEnds' });
      var dReason = input({ type: 'text', id: 'dReason' });

      var discountForm = el('div', {}, [
        el('div', { class: 'field-row' }, [field('Kind', kind), field('Amount', value)]),
        el('div', { class: 'field-row' }, [field('Label', label), field('Billing cycles', cycles, 'Blank = until withdrawn')]),
        el('div', { class: 'field-row' }, [field('Ends on', ends), field('Reason', dReason)]),
        el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: function (e) {
          busy(e.target, true);
          api('/discounts', { method: 'POST', body: {
            school_id: school.school_id, kind: kind.value, value: value.value,
            label: label.value, cycles: cycles.value, ends_at: ends.value, reason: dReason.value
          } }).then(function (r) { busy(e.target, false, 'Grant discount');
                                   if (ok(r, 'Discount granted.')) reload(); });
        } }, ['Grant discount'])
      ]);

      var percent = input({ type: 'number', min: '1', max: '100', value: '100', id: 'xPercent' });
      var xEnds = input({ type: 'date', id: 'xEnds' });
      var xReason = input({ type: 'text', id: 'xReason', placeholder: 'Pilot school — agreed with the proprietor' });
      var exemptionForm = el('div', {}, [
        el('div', { class: 'note' }, [el('p', {
          text: 'An exemption is not a discount. The school is billed as normal, ' +
                'the invoice is raised and marked EXEMPT, and no payment is attempted. ' +
                'It never appears as an unpaid customer in the revenue report.'
        })]),
        el('div', { class: 'field-row' }, [field('Covers', percent, 'Percent of the bill'), field('Ends on', xEnds, 'Blank = permanent')]),
        field('Reason', xReason, 'Required. It goes on the record and on the invoice.'),
        el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: function (e) {
          busy(e.target, true);
          api('/exemptions', { method: 'POST', body: {
            school_id: school.school_id, percent: percent.value,
            ends_at: xEnds.value, reason: xReason.value
          } }).then(function (r) { busy(e.target, false, 'Grant exemption');
                                   if (ok(r, 'Exemption granted.')) reload(); });
        } }, ['Grant exemption'])
      ]);

      return el('div', {}, [
        panel('Discounts', el('div', {}, [
          flush(table([
            { label: 'Discount', render: function (d) {
              return d.kind === 'percent' ? d.value + '%' : money(d.value); } },
            { label: 'Label', key: 'label' },
            { label: 'State', render: function (d) {
              return el('span', { class: 'tag ' + (d.in_force ? 'good' : ''), text: d.state }); } },
            { label: 'Cycles', render: function (d) {
              return d.cycles ? (d.cycles_used + ' of ' + d.cycles) : 'unlimited'; } },
            { label: 'Ends', render: function (d) { return day(d.ends_at); } },
            { label: '', render: function (d) {
              if (!d.in_force) return '';
              return el('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: function (e) {
                e.stopPropagation();
                var why = prompt('Withdraw this discount? Say why:');
                if (why === null) return;
                api('/discounts/' + d.id + '/revoke', { method: 'POST', body: { reason: why } })
                  .then(function (r) { if (ok(r, 'Discount withdrawn.')) reload(); });
              } }, ['Withdraw']);
            } }
          ], data.discounts || [], { empty: 'No discount has ever been granted to this school.' })),
          el('div', { style: 'padding:18px' }, [el('h3', { text: 'Grant a discount' }), discountForm])
        ])),
        panel('Payment exemptions', el('div', {}, [
          flush(table([
            { label: 'Covers', render: function (x) { return x.percent + '%'; } },
            { label: 'State', render: function (x) {
              return el('span', { class: 'tag ' + (x.in_force ? 'warn' : ''), text: x.state }); } },
            { label: 'Reason', key: 'reason' },
            { label: 'Ends', render: function (x) { return day(x.ends_at); } },
            { label: '', render: function (x) {
              if (!x.in_force) return '';
              return el('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: function () {
                var why = prompt('Withdraw this exemption?\n\nThe school will be billed ' +
                                 'normally from its next invoice. Say why:');
                if (why === null) return;
                api('/exemptions/' + x.id + '/revoke', { method: 'POST', body: { reason: why } })
                  .then(function (r) { if (ok(r, 'Exemption withdrawn.')) reload(); });
              } }, ['Withdraw']);
            } }
          ], data.exemptions || [], { empty: 'This school is billed normally.' })),
          el('div', { style: 'padding:18px' }, [el('h3', { text: 'Exempt this school' }), exemptionForm])
        ]))
      ]);
    }

    function invoicesPane() {
      return el('div', {}, [
        panel('Invoices', flush(table([
          { label: 'Number', key: 'invoice_number' },
          { label: 'Period', render: function (i) { return day(i.period_start) + ' → ' + day(i.period_end); } },
          { label: 'Pupils', num: true, render: function (i) { return count(i.student_count); } },
          { label: 'Gross', num: true, render: function (i) { return money(i.gross_amount, i.currency); } },
          { label: 'Discount', num: true, render: function (i) { return i.discount_amount ? '− ' + money(i.discount_amount, i.currency) : '—'; } },
          { label: 'Exempt', num: true, render: function (i) { return i.exemption_amount ? '− ' + money(i.exemption_amount, i.currency) : '—'; } },
          { label: 'Total', num: true, render: function (i) { return money(i.total_amount, i.currency); } },
          { label: 'Status', render: function (i) { return invoiceTag(i.status); } },
          { label: '', render: function (i) { return invoiceActions(i, reload); } }
        ], data.invoices || [], { empty: 'No invoice has been raised for this school yet.' })),
        [el('button', {
          class: 'btn btn-outline btn-sm', type: 'button', onclick: function (e) {
            busy(e.target, true, 'Raising…');
            api('/invoices', { method: 'POST', body: { school_id: school.school_id } })
              .then(function (r) { busy(e.target, false, 'Raise an invoice now');
                                   if (ok(r, 'Invoice raised.')) reload(); });
          }
        }, ['Raise an invoice now'])]),
        panel('Payments', flush(table([
          { label: 'When', render: function (p) { return when(p.settled_at || p.attempted_at); } },
          { label: 'Amount', num: true, render: function (p) { return money(p.amount, p.currency); } },
          { label: 'Status', render: function (p) {
            return el('span', { class: 'tag ' + (p.status === 'succeeded' ? 'good' :
                     p.status === 'failed' ? 'bad' : ''), text: p.status }); } },
          { label: 'Reference', key: 'provider_reference' },
          { label: '', render: function (p) {
            if (p.status !== 'succeeded') return '';
            return el('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: function () {
              var why = prompt('Refund this payment? Say why:');
              if (why === null) return;
              api('/payments/' + p.id + '/refund', { method: 'POST', body: { reason: why } })
                .then(function (r) { if (ok(r, 'Refunded.')) reload(); });
            } }, ['Refund']);
          } }
        ], data.payments || [], { empty: 'No payment has been taken from this school.' })))
      ]);
    }

    function historyPane() {
      return el('div', {}, [
        panel('Subscription events', flush(table([
          { label: 'When', render: function (e) { return when(e.at); } },
          { label: 'Event', key: 'event' },
          { label: 'Change', render: function (e) {
            return (e.from_status || '—') + ' → ' + (e.to_status || '—'); } },
          { label: 'Detail', key: 'detail' },
          { label: 'By', key: 'actor' }
        ], data.events || [], { empty: 'Nothing yet.' }))),
        panel('Usage over time', flush(table([
          { label: 'Taken', render: function (u) { return when(u.captured_at); } },
          { label: 'Billable', num: true, render: function (u) { return count(u.billable_students); } },
          { label: 'On roll', num: true, render: function (u) { return count(u.total_students); } },
          { label: 'Plan', key: 'plan_id' }
        ], data.usage_history || [], { empty: 'No snapshot yet.' }))),
        panel('Platform audit for this school', flush(table([
          { label: 'When', render: function (a) { return when(a.at); } },
          { label: 'What', key: 'action' },
          { label: 'By', key: 'actor' },
          { label: 'Detail', key: 'detail' }
        ], data.audit || [], { empty: 'Nothing recorded.' })))
      ]);
    }

    function detail(label, value) {
      return el('div', { class: 'row' }, [
        el('span', { class: 'k', text: label }),
        el('span', { class: 'v', text: String(value === null || value === undefined ? '—' : value) })
      ]);
    }

    function act(button, payload) {
      busy(button, true);
      api('/schools/' + encodeURIComponent(school.school_id) + '/subscription',
          { method: 'POST', body: payload }).then(function (result) {
        busy(button, false);
        if (ok(result)) reload();
      });
    }

    function lifecycle(action, question) {
      if (!confirm(question)) return;
      var why = action === 'suspend' || action === 'archive'
        ? prompt('Say why (it goes on the record):') : '';
      if (why === null) return;
      api('/schools/' + encodeURIComponent(school.school_id) + '/lifecycle',
          { method: 'POST', body: { action: action, reason: why } }).then(function (result) {
        if (ok(result)) reload();
      });
    }

    body.innerHTML = '';
    body.appendChild(tabBar);
    body.appendChild(panes);
    // The plan list is needed by the Billing tab; fetched once and cached.
    if (!state.cache.plans) {
      api('/plans').then(function (d) { state.cache.plans = d.plans || []; drawPane(); });
    }
    drawPane();
  }

  function invoiceActions(invoice, reload) {
    if (invoice.status === 'PAID' || invoice.status === 'VOID') return '';
    return el('span', { class: 'inline' }, [
      el('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: function (e) {
        e.stopPropagation();
        if (!confirm('Mark ' + invoice.invoice_number + ' as paid?\n\n' +
                     'Use this for a payment taken outside the platform — a bank ' +
                     'transfer or cash. It is recorded with your name on it.')) return;
        api('/invoices/' + invoice.id + '/pay', { method: 'POST', body: { reason: 'Recorded by an operator.' } })
          .then(function (r) { if (ok(r, 'Marked paid.')) reload(); });
      } }, ['Mark paid']),
      el('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: function (e) {
        e.stopPropagation();
        var why = prompt('Mark this invoice EXEMPT? Say why:');
        if (why === null) return;
        api('/invoices/' + invoice.id + '/exempt', { method: 'POST', body: { reason: why } })
          .then(function (r) { if (ok(r, 'Marked exempt.')) reload(); });
      } }, ['Exempt']),
      el('button', { class: 'btn btn-danger btn-sm', type: 'button', onclick: function (e) {
        e.stopPropagation();
        var why = prompt('Void this invoice? It will not count in any report. Say why:');
        if (why === null) return;
        api('/invoices/' + invoice.id + '/void', { method: 'POST', body: { reason: why } })
          .then(function (r) { if (ok(r, 'Voided.')) reload(); });
      } }, ['Void'])
    ]);
  }

  // ── plans ────────────────────────────────────────────────────────────────
  PAGES.plans = function (host) {
    api('/plans').then(function (data) {
      if (!data.ok) return show(host, el('div', { class: 'note bad', text: data.error }));
      state.cache.plans = data.plans;
      var panels = (data.plans || []).map(function (plan) { return planEditor(plan, data.intervals); });
      show(host, [
        head('Plans', 'Every price on the website, in the checkout and on an invoice comes ' +
                      'from these rows. Nothing here is in the code.',
             [el('button', { class: 'btn btn-outline', type: 'button', onclick: newPlan }, ['New plan'])]),
        el('div', { class: 'note' }, [el('p', {
          text: 'Changing a price changes what schools are billed from their NEXT invoice. ' +
                'Invoices already raised keep the figures they were raised with.'
        })])
      ].concat(panels));
    });
  };

  function planEditor(plan, intervals) {
    var fields = {};
    function box(key, label, attrs, hint) {
      fields[key] = input(Object.assign({ id: 'p_' + plan.plan_id + '_' + key,
                                          value: plan[key] === null || plan[key] === undefined ? '' : plan[key] }, attrs));
      return field(label, fields[key], hint);
    }
    function check(key, label) {
      fields[key] = input({ type: 'checkbox', id: 'p_' + plan.plan_id + '_' + key,
                            checked: plan[key] ? 'checked' : null });
      return el('label', { class: 'switch' }, [fields[key], document.createTextNode(label)]);
    }

    fields.billing_interval = select({}, (intervals || []).map(function (i) {
      return { value: i.key, label: i.label };
    }), plan.billing_interval);
    fields.trial_to_plan = select({}, [{ value: '', label: 'stay on this plan' }].concat(
      (state.cache.plans || []).map(function (p) { return { value: p.plan_id, label: p.name }; })),
      plan.trial_to_plan || '');

    var save = el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: function (e) {
      busy(e.target, true);
      var body = {};
      ['name', 'tagline', 'description', 'base_price', 'price_per_student',
       'included_students', 'max_students', 'trial_days', 'sort_order'].forEach(function (key) {
        if (fields[key]) body[key] = fields[key].value === '' && (key === 'max_students')
          ? null : fields[key].value;
      });
      ['trial_enabled', 'is_active', 'is_public', 'requires_payment_method'].forEach(function (key) {
        if (fields[key]) body[key] = fields[key].checked;
      });
      body.billing_interval = fields.billing_interval.value;
      body.trial_to_plan = fields.trial_to_plan.value || null;
      api('/plans/' + encodeURIComponent(plan.plan_id), { method: 'PATCH', body: body })
        .then(function (r) { busy(e.target, false, 'Save'); if (ok(r, plan.name + ' saved.')) route(); });
    } }, ['Save']);

    return panel(plan.name + '  (' + plan.plan_id + ')', el('div', {}, [
      el('div', { class: 'field-row' }, [box('name', 'Name', { type: 'text' }),
                                         box('tagline', 'Tagline', { type: 'text' })]),
      box('description', 'Description', { type: 'text' }),
      el('div', { class: 'field-row' }, [
        box('base_price', 'Base price', { type: 'number', step: '0.01', min: '0' },
            'Charged whatever the roll.'),
        box('price_per_student', 'Price per pupil', { type: 'number', step: '0.01', min: '0' })
      ]),
      el('div', { class: 'field-row' }, [
        box('included_students', 'Pupils included in the base price', { type: 'number', min: '0' }),
        box('max_students', 'Pupil ceiling', { type: 'number', min: '0' }, 'Blank = no ceiling.')
      ]),
      el('div', { class: 'field-row' }, [
        field('Billing interval', fields.billing_interval),
        box('trial_days', 'Trial length (days)', { type: 'number', min: '0' })
      ]),
      field('After the trial, move to', fields.trial_to_plan),
      box('sort_order', 'Order on the pricing page', { type: 'number', min: '0' }),
      el('div', { class: 'inline', style: 'margin:14px 0' }, [
        check('trial_enabled', 'Offers a trial'),
        check('is_active', 'Open for new subscriptions'),
        check('is_public', 'Shown on the pricing page'),
        check('requires_payment_method', 'Needs a card up front')
      ]),
      save
    ]), [el('span', { class: 'tag ' + (plan.is_active ? 'good' : 'bad'),
                      text: plan.is_active ? 'active' : 'closed' })]);
  }

  function newPlan() {
    var id = prompt('An id for the new plan (lowercase letters, digits and dashes):');
    if (!id) return;
    var name = prompt('And its name, as schools will see it:');
    if (!name) return;
    api('/plans', { method: 'POST', body: { plan_id: id.trim().toLowerCase(), name: name.trim(),
                                            currency: 'GHS', billing_interval: 'monthly' } })
      .then(function (r) { if (ok(r, 'Plan created.')) { state.cache.plans = null; route(); } });
  }

  // ── features ─────────────────────────────────────────────────────────────
  PAGES.features = function (host) {
    api('/features').then(function (data) {
      if (!data.ok) return show(host, el('div', { class: 'note bad', text: data.error }));
      var grid = data.grid;
      var held = {};
      grid.grid.forEach(function (cell) { held[cell.plan_id + '|' + cell.feature_key] = cell; });

      var columns = [{ label: 'Feature', render: function (f) {
        return el('span', {}, [
          el('b', { text: f.name }),
          el('div', { class: 'small muted', text: f.description }),
          f.is_core ? el('span', { class: 'tag info', text: 'in every plan' }) : null
        ]);
      } }].concat(grid.plans.map(function (plan) {
        return { label: plan.name, render: function (feature) {
          var cell = held[plan.plan_id + '|' + feature.feature_key] || {};
          var box = input({ type: 'checkbox', checked: cell.enabled ? 'checked' : null,
                            disabled: feature.is_core ? 'disabled' : null,
                            'aria-label': plan.name + ' — ' + feature.name });
          box.addEventListener('change', function () {
            api('/plan-features', { method: 'POST', body: {
              plan_id: plan.plan_id, feature_key: feature.feature_key, enabled: box.checked
            } }).then(function (r) {
              if (!r.ok) { box.checked = !box.checked; fail(r); }
              else toast(plan.name + ': ' + feature.name + (box.checked ? ' granted.' : ' withheld.'));
            });
          });
          return box;
        } };
      }));

      show(host, [
        head('Features', 'Which plan holds which capability. A change takes effect on every ' +
                         'school on that plan, on their next request — no deployment.'),
        el('div', { class: 'note' }, [el('p', {
          text: 'A feature marked “in every plan” cannot be withheld. Signing in, seeing your ' +
                'own school and paying your bill are not upsells.'
        })]),
        panel('Plan / feature grid', flush(table(columns, grid.features, { matrix: true })))
      ]);
    });
  };

  // ── subscriptions ────────────────────────────────────────────────────────
  PAGES.subscriptions = function (host) {
    api('/subscriptions').then(function (data) {
      if (!data.ok) return show(host, el('div', { class: 'note bad', text: data.error }));
      show(host, [
        head('Subscriptions', 'Every subscription the platform holds.'),
        panel('All subscriptions', flush(table([
          { label: 'School', render: function (s) {
            return el('span', {}, [el('b', { text: s.school_name }),
                                   el('div', { class: 'small muted', text: s.school_id })]); } },
          { label: 'Plan', key: 'plan_id' },
          { label: 'Status', render: function (s) { return statusTag(s.status, s.status_label); } },
          { label: 'Trial ends', render: function (s) { return day(s.trial_ends_at); } },
          { label: 'Period ends', render: function (s) { return day(s.current_period_end); } },
          { label: 'Negotiated', render: function (s) {
            return s.price_per_student_override !== null && s.price_per_student_override !== undefined
              ? money(s.price_per_student_override) + ' /pupil' : '—'; } }
        ], data.subscriptions || [], { onRow: function (s) { openSchool(s.school_id); } })))
      ]);
    });
  };

  // ── discounts and exemptions ─────────────────────────────────────────────
  PAGES.discounts = function (host) {
    api('/discounts').then(function (data) {
      if (!data.ok) return show(host, el('div', { class: 'note bad', text: data.error }));
      show(host, [
        head('Discounts', 'A price one school pays, below the plan’s. The plan is untouched.'),
        panel('Every discount ever granted', flush(table([
          { label: 'School', key: 'school_id' },
          { label: 'Discount', render: function (d) {
            return d.kind === 'percent' ? d.value + '%' : money(d.value); } },
          { label: 'Label', key: 'label' },
          { label: 'State', render: function (d) {
            return el('span', { class: 'tag ' + (d.in_force ? 'good' : ''), text: d.state }); } },
          { label: 'Cycles', render: function (d) {
            return d.cycles ? d.cycles_used + ' of ' + d.cycles : 'unlimited'; } },
          { label: 'Ends', render: function (d) { return day(d.ends_at); } },
          { label: 'Granted by', key: 'created_by' }
        ], data.discounts || [], { onRow: function (d) { openSchool(d.school_id); },
                                   empty: 'No discount has been granted on this platform.' })))
      ]);
    });
  };

  PAGES.exemptions = function (host) {
    api('/exemptions').then(function (data) {
      if (!data.ok) return show(host, el('div', { class: 'note bad', text: data.error }));
      show(host, [
        head('Payment exemptions', 'Schools Nickland has decided not to charge. Their invoices ' +
                                   'are raised and marked EXEMPT — never “unpaid”.'),
        panel('Every exemption ever granted', flush(table([
          { label: 'School', key: 'school_id' },
          { label: 'Covers', render: function (x) { return x.percent + '%'; } },
          { label: 'State', render: function (x) {
            return el('span', { class: 'tag ' + (x.in_force ? 'warn' : ''), text: x.state }); } },
          { label: 'Reason', key: 'reason' },
          { label: 'Ends', render: function (x) { return day(x.ends_at); } },
          { label: 'Granted by', key: 'created_by' }
        ], data.exemptions || [], { onRow: function (x) { openSchool(x.school_id); },
                                    empty: 'No school is exempt.' })))
      ]);
    });
  };

  // ── invoices and payments ────────────────────────────────────────────────
  PAGES.invoices = function (host) {
    api('/invoices').then(function (data) {
      if (!data.ok) return show(host, el('div', { class: 'note bad', text: data.error }));
      show(host, [
        head('Invoices', 'Every invoice the platform has raised. The figures on one are the ' +
                         'figures it was raised with, and do not move when a plan is repriced.'),
        panel('All invoices', flush(table([
          { label: 'Number', key: 'invoice_number' },
          { label: 'School', key: 'school_name' },
          { label: 'Period', render: function (i) { return day(i.period_start); } },
          { label: 'Pupils', num: true, render: function (i) { return count(i.student_count); } },
          { label: 'Gross', num: true, render: function (i) { return money(i.gross_amount, i.currency); } },
          { label: 'Total', num: true, render: function (i) { return money(i.total_amount, i.currency); } },
          { label: 'Status', render: function (i) { return invoiceTag(i.status); } },
          { label: 'Due', render: function (i) { return day(i.due_at); } }
        ], data.invoices || [], { onRow: function (i) { openSchool(i.school_id); } })))
      ]);
    });
  };

  PAGES.payments = function (host) {
    api('/payments').then(function (data) {
      if (!data.ok) return show(host, el('div', { class: 'note bad', text: data.error }));
      show(host, [
        head('Payments', 'What the provider actually did.'),
        panel('All payments', flush(table([
          { label: 'When', render: function (p) { return when(p.settled_at || p.attempted_at); } },
          { label: 'School', key: 'school_id' },
          { label: 'Amount', num: true, render: function (p) { return money(p.amount, p.currency); } },
          { label: 'Status', render: function (p) {
            return el('span', { class: 'tag ' + (p.status === 'succeeded' ? 'good' :
                     p.status === 'failed' ? 'bad' : p.status === 'refunded' ? 'warn' : ''),
                     text: p.status }); } },
          { label: 'Kind', key: 'kind' },
          { label: 'Reference', key: 'provider_reference' },
          { label: 'Why it failed', key: 'failure_reason' }
        ], data.payments || [], { onRow: function (p) { openSchool(p.school_id); } })))
      ]);
    });
  };

  // ── usage and reports ────────────────────────────────────────────────────
  PAGES.usage = function (host) {
    function load(refresh) {
      api('/usage' + (refresh ? '?refresh=1' : '')).then(function (data) {
        if (!data.ok) return show(host, el('div', { class: 'note bad', text: data.error }));
        show(host, [
          head('Usage', 'Billable pupils: ' + data.billable_statuses.join(', ') +
                        '. Everybody else is in the school’s database and is not charged for.', [
            el('button', { class: 'btn btn-outline', type: 'button', onclick: function (e) {
              busy(e.target, true, 'Counting…'); load(true);
            } }, ['Re-count from every school'])
          ]),
          el('div', { class: 'stats' }, [
            stat('Pupils billed', count(data.total), 'across every school'),
            stat('Schools', count((data.usage || []).length), ''),
            stat('Over their ceiling', count((data.usage || []).filter(function (u) {
              return u.over_ceiling; }).length), 'need a bigger plan')
          ]),
          panel('Per school', flush(table([
            { label: 'School', render: function (u) {
              return el('span', {}, [el('b', { text: u.name }),
                                     el('div', { class: 'small muted', text: u.school_id })]); } },
            { label: 'Plan', key: 'plan_id' },
            { label: 'Status', render: function (u) { return statusTag(u.status); } },
            { label: 'Billable', num: true, render: function (u) { return count(u.billable_students); } },
            { label: 'On roll', num: true, render: function (u) { return count(u.total_students); } },
            { label: 'Ceiling', num: true, render: function (u) {
              return u.ceiling ? count(u.ceiling) : '—'; } },
            { label: '', render: function (u) {
              return u.over_ceiling ? el('span', { class: 'tag bad', text: 'over' }) : ''; } },
            { label: 'Counted', render: function (u) { return when(u.as_of); } }
          ], data.usage || [], { onRow: function (u) { openSchool(u.school_id); } })))
        ]);
      });
    }
    load(false);
  };

  PAGES.reports = function (host) {
    api('/reports/revenue').then(function (data) {
      if (!data.ok) return show(host, el('div', { class: 'note bad', text: data.error }));
      var t = data.totals;
      show(host, [
        head('Reports', 'Gross, less discounts, less exemptions, billed, collected, outstanding.'),
        el('div', { class: 'grid2' }, [
          panel('The platform', waterfall(t)),
          panel('Counts', el('div', { class: 'rows' }, [
            row('Invoices', count(t.invoices)),
            row('Paid', count(t.paid_invoices)),
            row('Exempt', count(t.exempt_invoices)),
            row('Overdue', count(t.overdue_invoices)),
            row('Voided', count(t.voided_invoices)),
            row('Tax', money(t.tax))
          ]))
        ]),
        panel('By school', flush(table([
          { label: 'School', key: 'name' },
          { label: 'Gross', num: true, render: function (r) { return money(r.gross); } },
          { label: 'Discounts', num: true, render: function (r) { return r.discounts ? '− ' + money(r.discounts) : '—'; } },
          { label: 'Exemptions', num: true, render: function (r) { return r.exemptions ? '− ' + money(r.exemptions) : '—'; } },
          { label: 'Net billed', num: true, render: function (r) { return money(r.net_billed); } },
          { label: 'Collected', num: true, render: function (r) { return money(r.collected); } },
          { label: 'Outstanding', num: true, render: function (r) { return money(r.outstanding); } }
        ], (data.schools || []).filter(function (r) { return r.invoices; }),
           { onRow: function (r) { openSchool(r.school_id); },
             empty: 'Nothing has been invoiced yet.' })))
      ]);
    });
  };

  function row(label, value) {
    return el('div', { class: 'row' }, [el('span', { class: 'k', text: label }),
                                        el('span', { class: 'v', text: value })]);
  }

  // ── settings ─────────────────────────────────────────────────────────────
  var SETTING_LABELS = {
    currency: 'Currency (three-letter code)',
    tax_rate: 'Tax rate (%)',
    tax_label: 'Tax label',
    trial_enabled: 'Trials switched on (1 or 0)',
    default_plan: 'Default plan at registration',
    past_due_days: 'Days past due before the grace period',
    grace_period_days: 'Grace period, in days',
    invoice_due_days: 'Invoice due, in days',
    invoice_prefix: 'Invoice number prefix',
    billable_student_statuses: 'Billable pupil statuses (comma separated)',
    grandfather_existing: 'Schools with no subscription keep full access (1 or 0)',
    grandfather_plan: 'The plan those schools are treated as being on',
    suspended_access: 'What a suspended school may do (read_only or blocked)',
    support_email: 'Support email, shown on the website',
    support_phone: 'Support telephone, shown on the website',
    company_name: 'Company name',
    product_name: 'Product name'
  };

  PAGES.settings = function (host) {
    api('/settings').then(function (data) {
      if (!data.ok) return show(host, el('div', { class: 'note bad', text: data.error }));
      var inputs = {};
      var form = el('div', {}, (data.known || []).map(function (key) {
        inputs[key] = input({ type: 'text', id: 's_' + key, value: data.settings[key] || '' });
        return field(SETTING_LABELS[key] || key, inputs[key], key);
      }));

      show(host, [
        head('System settings', 'The SaaS rules that are not a plan. All of them are rows, ' +
                                'and all of them take effect at once.', [
          el('button', { class: 'btn btn-primary', type: 'button', onclick: function (e) {
            var body = {};
            Object.keys(inputs).forEach(function (key) { body[key] = inputs[key].value; });
            busy(e.target, true);
            api('/settings', { method: 'POST', body: body }).then(function (r) {
              busy(e.target, false, 'Save settings');
              ok(r, 'Settings saved.');
            });
          } }, ['Save settings'])
        ]),
        data.payments && data.payments.available
          ? el('div', { class: 'note good' }, [el('p', {
              text: 'Card payments are switched on for this deployment.' })])
          : el('div', { class: 'note warn' }, [el('p', {
              text: 'Card payments are OFF — PLATFORM_PAYSTACK_SECRET is not set on this ' +
                    'service. Schools can register and start a trial, but no card is taken ' +
                    'and no subscription can be charged.' })]),
        panel('Platform settings', form)
      ]);
    });
  };

  PAGES.operators = function (host) {
    api('/operators').then(function (data) {
      if (!data.ok) return show(host, el('div', { class: 'note bad', text: data.error }));
      show(host, [
        head('Operators', 'Who can open this console.', [
          el('button', { class: 'btn btn-outline', type: 'button', onclick: function () {
            var email = prompt('Email address for the new operator:');
            if (!email) return;
            var name = prompt('Their name:') || '';
            var password = prompt('A password for them (at least 10 characters):');
            if (!password) return;
            api('/operators', { method: 'POST', body: {
              email: email.trim(), full_name: name.trim(), password: password, role: 'superadmin'
            } }).then(function (r) { if (ok(r, 'Operator created.')) route(); });
          } }, ['Add an operator'])
        ]),
        panel('Console accounts', flush(table([
          { label: 'Email', key: 'email' },
          { label: 'Name', key: 'full_name' },
          { label: 'Role', key: 'role' },
          { label: 'Active', render: function (o) {
            return el('span', { class: 'tag ' + (o.is_active ? 'good' : 'bad'),
                                text: o.is_active ? 'active' : 'off' }); } },
          { label: 'Last signed in', render: function (o) { return when(o.last_login_at); } },
          { label: '', render: function (o) {
            return el('button', { class: 'btn btn-outline btn-sm', type: 'button', onclick: function () {
              api('/operators/' + o.id + '/status', { method: 'POST', body: { is_active: !o.is_active } })
                .then(function (r) { if (ok(r)) route(); });
            } }, [o.is_active ? 'Deactivate' : 'Reactivate']);
          } }
        ], data.operators || [])))
      ]);
    });
  };

  PAGES.audit = function (host) {
    var refused = false;
    function load() {
      api('/audit?limit=400' + (refused ? '&refused=1' : '')).then(function (data) {
        if (!data.ok) return show(host, el('div', { class: 'note bad', text: data.error }));
        show(host, [
          head('Audit trail', 'Every administrative and billing act on this platform, with ' +
                              'who did it and when.', [
            el('button', { class: 'btn btn-outline', type: 'button', onclick: function () {
              refused = !refused; load();
            } }, [refused ? 'Show everything' : 'Refusals only'])
          ]),
          panel(refused ? 'Refusals' : 'Everything', flush(table([
            { label: 'When', render: function (a) { return when(a.at); } },
            { label: 'Action', key: 'action' },
            { label: 'School', key: 'school_id' },
            { label: 'By', key: 'actor' },
            { label: 'Outcome', render: function (a) {
              return el('span', { class: 'tag ' + (a.outcome === 'ok' ? '' : 'bad'),
                                  text: a.outcome }); } },
            { label: 'Detail', key: 'detail' },
            { label: 'From', key: 'remote_addr' }
          ], data.audit || [], { empty: 'Nothing recorded yet.' })))
        ]);
      });
    }
    load();
  };

  // ── start ────────────────────────────────────────────────────────────────
  function start() {
    $('#signinForm').addEventListener('submit', signIn);
    $('#bootstrapForm').addEventListener('submit', bootstrap);
    $('#showBootstrap').addEventListener('click', function (e) {
      e.preventDefault();
      $('#bootstrapForm').hidden = !$('#bootstrapForm').hidden;
    });
    $('#signOut').addEventListener('click', function () { signOut(false); });
    window.addEventListener('hashchange', function () { if (state.token) route(); });

    try { state.token = sessionStorage.getItem(TOKEN_KEY); } catch (e) { state.token = null; }
    if (!state.token) return;
    api('/me').then(function (result) {
      if (result.ok) { state.operator = result.operator; enterConsole(); }
      else signOut(false);
    }).catch(function () { signOut(false); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
