// Nickland Edusoft — End of Term Report Panel
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../store/index.js';
import { fullName } from '../../lib/format.js';

export default function EndOfTermReportPanel() {
  const classes = useStore(s => s.classes);
  const currentTerm = useStore(s => s.currentTerm);
  const showToast = useStore(s => s.showToast);
  const navigate = useNavigate();
  const [classId, setClassId] = useState('');
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState({});
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!classId) { setStudents([]); return; }
    (async () => {
      const list = await window.api.students.list({ classId, status: 'Active' });
      setStudents(list);
      setSelected({});
    })();
  }, [classId]);

  function toggle(id) {
    setSelected(prev => ({ ...prev, [id]: !prev[id] }));
  }
  function selectAll() {
    const next = {};
    students.forEach(s => next[s.id] = true);
    setSelected(next);
  }
  function clearAll() {
    setSelected({});
  }

  async function generateReports() {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => parseInt(k));
    if (ids.length === 0) {
      showToast('Select at least one student', 'warning');
      return;
    }
    setGenerating(true);
    try {
      const res = await window.api.reports.generateReportCards({
        termId: currentTerm.id,
        classId: classId ? parseInt(classId) : undefined,
        studentIds: ids,
        scope: 'selected',
      });
      if (res.ok) {
        showToast(`Prepared ${ids.length} report card${ids.length > 1 ? 's' : ''}`, 'success');
        await window.api.app.openPdfPreview(res.path);
      } else {
        showToast(res.error || 'Generation failed', 'error');
      }
    } catch (e) {
      showToast(e.message, 'error');
    }
    setGenerating(false);
  }

  async function printWholeClass() {
    if (!classId) { showToast('Select a class first', 'warning'); return; }
    setGenerating(true);
    try {
      const res = await window.api.reports.generateReportCards({
        termId: currentTerm.id,
        classId: parseInt(classId),
        scope: 'class',
      });
      if (res.ok) {
        showToast(`Prepared ${res.count} report card${res.count > 1 ? 's' : ''} for the whole class`, 'success');
        await window.api.app.openPdfPreview(res.path);
      } else {
        showToast(res.error || 'Generation failed', 'error');
      }
    } catch (e) {
      showToast(e.message, 'error');
    }
    setGenerating(false);
  }

  const selectedCount = Object.values(selected).filter(Boolean).length;

  // Ranking preview state
  const [ranking, setRanking] = useState(null);
  const [rankSort, setRankSort] = useState('position');
  const [rankSubject, setRankSubject] = useState('');
  const [loadingRank, setLoadingRank] = useState(false);

  useEffect(() => {
    if (!classId || !currentTerm) { setRanking(null); return; }
    (async () => {
      setLoadingRank(true);
      const res = await window.api.scores.endOfTerm({ classId: parseInt(classId), termId: currentTerm.id });
      setRanking(res);
      setLoadingRank(false);
    })();
  }, [classId, currentTerm?.id]);

  function rankedRows() {
    if (!ranking) return [];
    const rows = [...ranking.students];
    if (rankSubject) {
      rows.sort((a, b) => (b.per_subject[rankSubject]?.total || 0) - (a.per_subject[rankSubject]?.total || 0));
    } else if (rankSort === 'lowest') {
      rows.sort((a, b) => a.average - b.average);
    } else if (rankSort === 'name') {
      rows.sort((a, b) => `${a.surname} ${a.first_name}`.localeCompare(`${b.surname} ${b.first_name}`));
    } else {
      rows.sort((a, b) => a.position - b.position); // position = highest first
    }
    return rows;
  }

  return (
    <div className="end-of-term-report-panel">
      <div className="card">
        <div className="section-header">
          <div className="section-title">Print End of Term Reports</div>
          <span className="text-sm text-muted">
            Term: <strong>{currentTerm?.label || '—'}</strong>
          </span>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Class</label>
            <select value={classId} onChange={e => setClassId(e.target.value)}>
              <option value="">— Select Class —</option>
              {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {classId && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="section-header">
            <div className="section-title">Select Students ({selectedCount}/{students.length})</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-outline btn-sm" onClick={selectAll}>Select All</button>
              <button className="btn btn-ghost btn-sm" onClick={clearAll}>Clear</button>
              <button className="btn btn-outline btn-sm" disabled={generating}
                onClick={printWholeClass}>
                🖨 Print Whole Class
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={selectedCount === 0 || generating}
                onClick={generateReports}
              >
                {generating ? 'Preparing…' : `🖨 Print Selected ${selectedCount > 0 ? `(${selectedCount})` : ''}`}
              </button>
            </div>
          </div>
          {students.length === 0
            ? <div className="empty-state">No active students in this class</div>
            : <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>
                        <input type="checkbox"
                          checked={selectedCount === students.length && students.length > 0}
                          onChange={(e) => e.target.checked ? selectAll() : clearAll()}
                        />
                      </th>
                      <th>Index No.</th>
                      <th>Name</th>
                      <th>Gender</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map(s => (
                      <tr key={s.id}>
                        <td>
                          <input type="checkbox"
                            checked={!!selected[s.id]}
                            onChange={() => toggle(s.id)}
                          />
                        </td>
                        <td style={{ fontFamily: 'monospace' }} className="td-muted">{s.index_number}</td>
                        <td><strong>{s.surname} {s.first_name}</strong></td>
                        <td>{s.gender}</td>
                        <td>
                          <button className="btn btn-ghost btn-sm"
                            onClick={() => navigate(`/academics/report/${s.id}`)}
                          >View →</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
          }
        </div>
      )}

      {/* Ranking & Position preview */}
      {classId && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Class Ranking</div>
              <div className="text-sm text-muted">Positions by overall average, or rank by a single subject</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select className="select" value={rankSubject}
                onChange={e => setRankSubject(e.target.value)} style={{ maxWidth: 160 }}>
                <option value="">Overall</option>
                {ranking?.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select className="select" value={rankSort}
                onChange={e => { setRankSort(e.target.value); setRankSubject(''); }}
                style={{ maxWidth: 160 }} disabled={!!rankSubject}>
                <option value="position">Highest first</option>
                <option value="lowest">Lowest first</option>
                <option value="name">Name (A–Z)</option>
              </select>
              <button className="btn btn-outline btn-sm" onClick={() => window.print()}>🖨 Print</button>
            </div>
          </div>
          {loadingRank
            ? <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
            : !ranking || ranking.students.length === 0
              ? <div className="empty-state">No results recorded for this class yet</div>
              : <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 60 }}>{rankSubject ? 'Rank' : 'Position'}</th>
                        <th>Index No.</th>
                        <th>Name</th>
                        {rankSubject
                          ? <th className="text-center">Subject Total</th>
                          : <>
                              <th className="text-center">Grand Total</th>
                              <th className="text-center">Average</th>
                            </>
                        }
                      </tr>
                    </thead>
                    <tbody>
                      {rankedRows().map((st, i) => (
                        <tr key={st.student_id}>
                          <td style={{ fontWeight: 700 }}>
                            {rankSubject ? (i + 1) : st.position}
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: 11 }} className="td-muted">{st.index_number}</td>
                          <td><strong>{st.surname} {st.first_name}</strong></td>
                          {rankSubject
                            ? <td className="text-center" style={{ fontWeight: 600 }}>
                                {st.per_subject[rankSubject]?.total ?? 0}
                              </td>
                            : <>
                                <td className="text-center" style={{ fontWeight: 600 }}>{st.grand_total}</td>
                                <td className="text-center" style={{ fontWeight: 700, color: 'var(--primary)' }}>{st.average}</td>
                              </>
                          }
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
          }
        </div>
      )}
    </div>
  );
}
