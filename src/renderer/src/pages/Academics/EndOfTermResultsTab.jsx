// Nickland Edusoft — End of Term Results (class 40% + exam 60% combined)
// Per subject: class score, exam-converted, total. Plus grand total, average, position.
// Filters and rankings included.
import React, { useEffect, useState } from 'react';
import { useStore } from '../../store/index.js';

export default function EndOfTermResultsTab() {
  const { classes, currentTerm } = useStore();
  const [classId, setClassId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState('position');   // position | name | average | grand_total
  const [subjectFilter, setSubjectFilter] = useState(''); // '' = all, else subject id to rank by

  async function load() {
    if (!classId || !currentTerm) { setData(null); return; }
    setLoading(true);
    const res = await window.api.scores.endOfTerm({ classId, termId: currentTerm.id });
    setData(res);
    setLoading(false);
  }
  useEffect(() => { load(); }, [classId, currentTerm?.id]);

  function sortedStudents() {
    if (!data) return [];
    const rows = [...data.students];
    if (subjectFilter) {
      // Rank by a specific subject's total
      rows.sort((a, b) => (b.per_subject[subjectFilter]?.total || 0) - (a.per_subject[subjectFilter]?.total || 0));
      return rows;
    }
    switch (sortBy) {
      case 'name':        rows.sort((a, b) => `${a.surname} ${a.first_name}`.localeCompare(`${b.surname} ${b.first_name}`)); break;
      case 'average':     rows.sort((a, b) => b.average - a.average); break;
      case 'grand_total': rows.sort((a, b) => b.grand_total - a.grand_total); break;
      default:            rows.sort((a, b) => a.position - b.position); break;
    }
    return rows;
  }

  const rows = sortedStudents();

  return (
    <div className="eot-results-tab">
      <div className="card no-print">
        <div className="section-header">
          <div>
            <div className="section-title">End of Term Results</div>
            <div className="text-sm text-muted">
              Combined results: each subject's Class score + converted Exam score, using its own weights (Settings → Subjects).
            </div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => window.print()}>🖨 Print Results</button>
        </div>
        <div className="form-row" style={{ marginTop: 14 }}>
          <div className="form-group">
            <label>Class</label>
            <select value={classId} onChange={e => setClassId(e.target.value)}>
              <option value="">— Select Class —</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Rank / Sort by</label>
            <select value={sortBy} onChange={e => { setSortBy(e.target.value); setSubjectFilter(''); }}>
              <option value="position">Position (highest average first)</option>
              <option value="average">Average score</option>
              <option value="grand_total">Grand total</option>
              <option value="name">Name (A–Z)</option>
            </select>
          </div>
          <div className="form-group">
            <label>Or rank by subject</label>
            <select value={subjectFilter} onChange={e => setSubjectFilter(e.target.value)}>
              <option value="">— Overall —</option>
              {data?.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Term</label>
            <div style={{ fontWeight: 600, padding: '8px 0' }}>{currentTerm?.label || '—'}</div>
          </div>
        </div>
      </div>

      {!classId
        ? <div className="card empty-state" style={{ marginTop: 16, padding: 40 }}>Select a class to view results</div>
        : loading
          ? <div className="card" style={{ marginTop: 16, padding: 40, textAlign: 'center' }}><div className="spinner" /></div>
          : data && (
            <div className="card" style={{ marginTop: 16, padding: 0 }}>
              <div className="sheet-wrap">
                <table className="sheet-table scores-table">
                  <thead>
                    <tr>
                      <th className="sheet-row-num-header" rowSpan="2">Pos.</th>
                      <th style={{ minWidth: 90 }} rowSpan="2">Index No.</th>
                      <th style={{ minWidth: 150 }} rowSpan="2">Name</th>
                      {data.subjects.map(sub => (
                        <th key={sub.id} colSpan="3" className="exam-subject-header">{sub.name}</th>
                      ))}
                      <th style={{ minWidth: 80 }} rowSpan="2" className="text-center">Grand Total</th>
                      <th style={{ minWidth: 70 }} rowSpan="2" className="text-center">Average</th>
                    </tr>
                    <tr>
                      {data.subjects.map(sub => (
                        <React.Fragment key={sub.id}>
                          <th className="exam-sub-col text-xs">Cls<br/>{sub.class_weight_pct ?? 40}%</th>
                          <th className="exam-sub-col text-xs">Exam<br/>{sub.exam_weight_pct ?? 60}%</th>
                          <th className="exam-sub-col exam-converted-col text-xs">Total<br/>100%</th>
                        </React.Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((st, i) => (
                      <tr key={st.student_id}>
                        <td className="sheet-row-num">
                          {subjectFilter ? (i + 1) : st.position}
                        </td>
                        <td className="sheet-cell" style={{ fontFamily: 'monospace', fontSize: 11 }}>{st.index_number}</td>
                        <td className="sheet-cell"><strong>{st.surname}</strong>, {st.first_name}</td>
                        {data.subjects.map(sub => {
                          const ps = st.per_subject[sub.id] || { class_score: 0, exam_converted: 0, total: 0 };
                          return (
                            <React.Fragment key={sub.id}>
                              <td className="sheet-cell text-center text-sm">{ps.class_score}</td>
                              <td className="sheet-cell text-center text-sm">{ps.exam_converted}</td>
                              <td className="sheet-cell text-center exam-converted-cell" style={{ fontWeight: 600 }}>
                                {ps.total}
                              </td>
                            </React.Fragment>
                          );
                        })}
                        <td className="sheet-cell text-center" style={{ fontWeight: 700 }}>{st.grand_total}</td>
                        <td className="sheet-cell text-center" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                          {st.average}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
      }
    </div>
  );
}
