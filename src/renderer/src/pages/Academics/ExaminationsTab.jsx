// Nickland Edusoft — Examinations Tab
// Full in-app question editor + question bank + exam builder
import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/index.js';

const SUB_TABS = [
  { id: 'papers',   label: 'Exam Papers' },
  { id: 'bank',     label: 'Question Bank' },
];

export default function ExaminationsTab() {
  const [sub, setSub] = useState('papers');

  return (
    <div className="examinations-tab">
      <div className="sub-tabs">
        {SUB_TABS.map(t => (
          <button
            key={t.id}
            className={'sub-tab' + (sub === t.id ? ' active' : '')}
            onClick={() => setSub(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 16 }}>
        {sub === 'papers' && <ExamPapersPanel />}
        {sub === 'bank'   && <QuestionBankPanel />}
      </div>
    </div>
  );
}

// ── Exam Papers Panel ──────────────────────────────────
function ExamPapersPanel() {
  const { classes, subjects, currentTerm } = useStore();
  const showToast = useStore(s => s.showToast);
  const [papers, setPapers] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingPaper, setEditingPaper] = useState(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const list = await window.api.exams.listPapers({});
    setPapers(list);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  async function handleDelete(id) {
    if (!confirm('Delete this exam paper and all its questions?')) return;
    await window.api.exams.deletePaper(id);
    showToast('Exam paper deleted', 'success');
    refresh();
  }

  if (editingPaper) {
    return <ExamPaperEditor
      paperId={editingPaper}
      onClose={() => { setEditingPaper(null); refresh(); }}
    />;
  }

  return (
    <>
      <div className="card">
        <div className="section-header">
          <div>
            <div className="section-title">Exam Papers</div>
            <div className="text-sm text-muted">Build, edit, and export examination papers</div>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <IconPlus /> &nbsp;New Exam Paper
          </button>
        </div>

        {loading ? <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
          : papers.length === 0
            ? <div className="empty-state">No exam papers yet. Click "New Exam Paper" to create one.</div>
            : <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Class</th>
                      <th>Subject</th>
                      <th>Term</th>
                      <th>Type</th>
                      <th>Questions</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {papers.map(p => (
                      <tr key={p.id}>
                        <td><strong>{p.title}</strong></td>
                        <td>{p.class_short || '—'}</td>
                        <td>{p.subject_name || '—'}</td>
                        <td>{p.term_label || '—'}</td>
                        <td><span className="badge badge-muted">{p.exam_type}</span></td>
                        <td>{p.question_count}</td>
                        <td>
                          <span className={'badge ' + (p.status === 'published' ? 'badge-success' : 'badge-warning')}>
                            {p.status}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditingPaper(p.id)}>Open</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(p.id)}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
        }
      </div>

      {showCreate && (
        <ExamPaperCreateModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => { setShowCreate(false); setEditingPaper(id); }}
        />
      )}
    </>
  );
}

// ── Create exam paper modal ────────────────────────────
function ExamPaperCreateModal({ onClose, onCreated }) {
  const { classes, subjects, currentTerm } = useStore();
  const showToast = useStore(s => s.showToast);
  const [form, setForm] = useState({
    title: '',
    class_group_id: '',
    subject_id: '',
    term_id: currentTerm?.id || '',
    exam_type: 'end_of_term',
    duration_minutes: 60,
    total_marks: 100,
    instructions: '',
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.title.trim()) return showToast('Title is required', 'warning');
    setSaving(true);
    const res = await window.api.exams.savePaper(form);
    setSaving(false);
    if (res.ok) onCreated(res.id);
    else showToast(res.error || 'Failed to save', 'error');
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">New Exam Paper</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form-row">
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>Paper Title</label>
            <input type="text" value={form.title ?? ''}
              onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. End of Term Exam — Basic 4 Mathematics" autoFocus />
          </div>
          <div className="form-group">
            <label>Class</label>
            <select value={form.class_group_id ?? ''} onChange={e => setForm({ ...form, class_group_id: e.target.value })}>
              <option value="">— Select —</option>
              {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Subject</label>
            <select value={form.subject_id ?? ''} onChange={e => setForm({ ...form, subject_id: e.target.value })}>
              <option value="">— Select —</option>
              {subjects.map(s => <option key={s.id} value={s.id ?? ''}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Exam Type</label>
            <select value={form.exam_type ?? ''} onChange={e => setForm({ ...form, exam_type: e.target.value })}>
              <option value="end_of_term">End of Term</option>
              <option value="mid_term">Mid Term</option>
              <option value="mock">Mock</option>
              <option value="class_test">Class Test</option>
              <option value="quiz">Quiz</option>
            </select>
          </div>
          <div className="form-group">
            <label>Duration (minutes)</label>
            <input type="number" value={form.duration_minutes ?? ''}
              onChange={e => setForm({ ...form, duration_minutes: parseInt(e.target.value) || 60 })} />
          </div>
          <div className="form-group">
            <label>Total Marks</label>
            <input type="number" value={form.total_marks ?? ''}
              onChange={e => setForm({ ...form, total_marks: parseInt(e.target.value) || 100 })} />
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>Instructions to Candidates</label>
            <textarea rows="3" value={form.instructions ?? ''}
              onChange={e => setForm({ ...form, instructions: e.target.value })}
              placeholder="e.g. Answer ALL questions in Section A and any THREE from Section B" />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Creating…' : 'Create & Edit Questions'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Exam Paper Editor ──────────────────────────────────
function ExamPaperEditor({ paperId, onClose }) {
  const showToast = useStore(s => s.showToast);
  const [paper, setPaper] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [showBankPicker, setShowBankPicker] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const p = await window.api.exams.getPaper(paperId);
    setPaper(p);
    setQuestions(p?.questions || []);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [paperId]);

  async function deleteQuestion(id) {
    if (!confirm('Delete this question?')) return;
    await window.api.exams.deleteQuestion(id);
    showToast('Question deleted', 'success');
    refresh();
  }

  async function publishToggle() {
    const newStatus = paper.status === 'published' ? 'draft' : 'published';
    await window.api.exams.savePaper({ ...paper, status: newStatus });
    showToast(newStatus === 'published' ? 'Paper published' : 'Paper unpublished', 'success');
    refresh();
  }

  async function exportPaper() {
    if (questions.length === 0) {
      showToast('Add at least one question before exporting', 'warning');
      return;
    }
    setExporting(true);
    const res = await window.api.exams.exportPaper(paperId, { colorMode: 'mono' });
    setExporting(false);
    if (!res.ok) { showToast(res.error || 'Export failed', 'error'); return; }
    showToast(`Generated ${res.total_questions} questions, ${res.total_marks} marks`, 'success');
    await window.api.app.openPdfPreview(res.path);
  }

  async function addBankQuestions(selectedIds) {
    if (!selectedIds || selectedIds.length === 0) return;
    const res = await window.api.exams.copyFromBank({
      paperId, sectionId: null, questionIds: selectedIds,
    });
    if (res.ok) {
      showToast(`Added ${res.copied} question${res.copied > 1 ? 's' : ''} from bank`, 'success');
      setShowBankPicker(false);
      refresh();
    } else {
      showToast(res.error || 'Could not add questions', 'error');
    }
  }

  if (loading || !paper) {
    return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;
  }

  const totalMarks = questions.reduce((s, q) => s + (q.marks || 0), 0);

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>← Back to Papers</button>
            <h2 style={{ marginTop: 8 }}>{paper.title}</h2>
            <div className="text-sm text-muted" style={{ marginTop: 4 }}>
              {paper.class_name && `${paper.class_name} · `}
              {paper.subject_name && `${paper.subject_name} · `}
              {paper.term_label} · {paper.duration_minutes} min · {totalMarks} marks ({questions.length} questions)
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span className={'badge ' + (paper.status === 'published' ? 'badge-success' : 'badge-warning')}
                  style={{ alignSelf: 'center' }}>
              {paper.status}
            </span>
            <button className="btn btn-outline btn-sm" onClick={publishToggle}>
              {paper.status === 'published' ? 'Unpublish' : 'Publish'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={exportPaper} disabled={exporting}>
              <IconDownload /> &nbsp;{exporting ? 'Generating…' : 'Print Paper (PDF)'}
            </button>
          </div>
        </div>
        {paper.instructions && (
          <div className="info-banner">
            <strong>Instructions:</strong> {paper.instructions}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="section-header">
          <div className="section-title">Questions ({questions.length})</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline" onClick={() => setShowBankPicker(true)}>
              📚 Pull from Bank
            </button>
            <button className="btn btn-primary" onClick={() => setEditingQuestion({})}>
              <IconPlus /> &nbsp;Add Question
            </button>
          </div>
        </div>

        {questions.length === 0
          ? <div className="empty-state">No questions yet. Click "Add Question" to type one, or "Pull from Bank" to reuse questions you've already created.</div>
          : <div className="question-list">
              {questions.map((q, i) => (
                <div key={q.id} className="question-row">
                  <div className="question-num">{i + 1}.</div>
                  <div className="question-body">
                    <div className="question-type-row">
                      <span className="badge badge-primary">{q.question_type}</span>
                      <span className="badge badge-muted">{q.marks} marks</span>
                      <span className="badge badge-accent">{q.difficulty}</span>
                    </div>
                    <div className="question-text" style={{ marginTop: 6 }}>{q.question_text}</div>
                    {q.question_type === 'multiple_choice' && (
                      <div className="mcq-options">
                        {['A','B','C','D'].map(letter => {
                          const opt = q['option_' + letter.toLowerCase()];
                          if (!opt) return null;
                          return (
                            <div key={letter}
                              className={'mcq-option' + (q.correct_option === letter ? ' correct' : '')}>
                              <strong>{letter}.</strong> {opt}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="question-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingQuestion(q)}>Edit</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => deleteQuestion(q.id)}>×</button>
                  </div>
                </div>
              ))}
            </div>
        }
      </div>

      {editingQuestion !== null && (
        <QuestionEditorModal
          question={editingQuestion}
          paperId={paperId}
          classGroupId={paper.class_group_id}
          subjectId={paper.subject_id}
          onClose={() => setEditingQuestion(null)}
          onSaved={() => { setEditingQuestion(null); refresh(); }}
        />
      )}

      {showBankPicker && (
        <BankPickerModal
          classGroupId={paper.class_group_id}
          subjectId={paper.subject_id}
          excludeIds={questions.map(q => q.id)}
          onClose={() => setShowBankPicker(false)}
          onPick={addBankQuestions}
        />
      )}
    </>
  );
}

// ── Bank Picker Modal — choose existing bank questions to add ──
function BankPickerModal({ classGroupId, subjectId, excludeIds = [], onClose, onPick }) {
  const [questions, setQuestions] = useState([]);
  const [selected, setSelected] = useState({});
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const list = await window.api.exams.listQuestions({
        classId: classGroupId, subjectId, inBank: true,
      });
      // Filter out questions already in this paper (by display only —
      // user could intentionally duplicate, but we hide them to reduce mistakes)
      setQuestions(list || []);
      setLoading(false);
    })();
  }, [classGroupId, subjectId]);

  const filtered = questions.filter(q => {
    if (typeFilter && q.question_type !== typeFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!q.question_text.toLowerCase().includes(s)) return false;
    }
    return true;
  });

  const selectedCount = Object.values(selected).filter(Boolean).length;
  function toggle(id) { setSelected(prev => ({ ...prev, [id]: !prev[id] })); }

  function submit() {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => parseInt(k));
    onPick(ids);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: 820 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Pull Questions from Bank</div>
            <div className="text-sm text-muted">Pick existing bank questions to copy into this paper</div>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="form-row">
          <div className="form-group" style={{ flex: 2 }}>
            <label>Search</label>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search question text..." />
          </div>
          <div className="form-group">
            <label>Type</label>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              <option value="multiple_choice">Multiple Choice</option>
              <option value="true_false">True / False</option>
              <option value="fill_blank">Fill in the Blank</option>
              <option value="short_answer">Short Answer</option>
              <option value="essay">Essay</option>
            </select>
          </div>
        </div>

        {loading
          ? <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
          : filtered.length === 0
            ? <div className="empty-state">
                No matching bank questions. Go to the <strong>Question Bank</strong> tab to create reusable questions for this subject.
              </div>
            : <div style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                {filtered.map(q => (
                  <div key={q.id} className="bank-picker-row" onClick={() => toggle(q.id)}>
                    <input type="checkbox" checked={!!selected[q.id]} readOnly
                      style={{ marginTop: 3 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                        <span className="badge badge-primary" style={{ fontSize: 10 }}>{q.question_type}</span>
                        <span className="badge badge-muted" style={{ fontSize: 10 }}>{q.marks} marks</span>
                        <span className="badge badge-accent" style={{ fontSize: 10 }}>{q.difficulty}</span>
                      </div>
                      <div style={{ fontSize: 13 }}>{q.question_text}</div>
                    </div>
                  </div>
                ))}
              </div>
        }

        <div className="modal-footer">
          <span className="text-sm text-muted" style={{ marginRight: 'auto' }}>
            {selectedCount} selected
          </span>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={selectedCount === 0}>
            Add {selectedCount > 0 ? `${selectedCount} ` : ''}to Paper
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Question Editor Modal ──────────────────────────────
function QuestionEditorModal({ question, paperId, classGroupId, subjectId, onClose, onSaved }) {
  const showToast = useStore(s => s.showToast);
  const [form, setForm] = useState({
    id: question.id || null,
    exam_paper_id: paperId,
    class_group_id: classGroupId || null,
    subject_id: subjectId || null,
    question_type: question.question_type || 'essay',
    question_text: question.question_text || '',
    marks: question.marks || 1,
    difficulty: question.difficulty || 'medium',
    option_a: question.option_a || '',
    option_b: question.option_b || '',
    option_c: question.option_c || '',
    option_d: question.option_d || '',
    correct_option: question.correct_option || '',
    model_answer: question.model_answer || '',
    in_question_bank: question.in_question_bank !== undefined ? question.in_question_bank : true,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.question_text.trim()) return showToast('Question text is required', 'warning');
    if (form.question_type === 'multiple_choice') {
      if (!form.option_a || !form.option_b) return showToast('At least options A and B are required for multiple choice', 'warning');
      if (!form.correct_option) return showToast('Mark the correct option', 'warning');
    }
    setSaving(true);
    const res = await window.api.exams.saveQuestion(form);
    setSaving(false);
    if (res.ok) {
      showToast('Question saved', 'success');
      onSaved();
    } else {
      showToast(res.error || 'Save failed', 'error');
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">{form.id ? 'Edit Question' : 'Add Question'}</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Question Type</label>
            <select value={form.question_type ?? ''} onChange={e => setForm({ ...form, question_type: e.target.value })}>
              <option value="essay">Essay / Structured</option>
              <option value="multiple_choice">Multiple Choice</option>
              <option value="short_answer">Short Answer</option>
              <option value="true_false">True / False</option>
              <option value="fill_blank">Fill in the Blank</option>
            </select>
          </div>
          <div className="form-group">
            <label>Marks</label>
            <input type="number" value={form.marks ?? ''} min="0" step="0.5"
              onChange={e => setForm({ ...form, marks: parseFloat(e.target.value) || 1 })} />
          </div>
          <div className="form-group">
            <label>Difficulty</label>
            <select value={form.difficulty ?? ''} onChange={e => setForm({ ...form, difficulty: e.target.value })}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
        </div>

        <div className="form-group" style={{ marginTop: 12 }}>
          <label>Question Text</label>
          <textarea rows="4" value={form.question_text ?? ''}
            onChange={e => setForm({ ...form, question_text: e.target.value })}
            placeholder="Type the question here..." autoFocus />
        </div>

        {/* Options for multiple choice */}
        {form.question_type === 'multiple_choice' && (
          <div className="mcq-edit" style={{ marginTop: 12 }}>
            <label className="form-section">Answer Choices</label>
            {['a', 'b', 'c', 'd'].map(letter => (
              <div key={letter} className="mcq-edit-row">
                <input
                  type="radio"
                  name="correct"
                  checked={form.correct_option === letter.toUpperCase()}
                  onChange={() => setForm({ ...form, correct_option: letter.toUpperCase() })}
                  title="Mark as correct answer"
                />
                <strong>{letter.toUpperCase()}.</strong>
                <input type="text"
                  value={form['option_' + letter] || ''}
                  onChange={e => setForm({ ...form, ['option_' + letter]: e.target.value })}
                  placeholder={`Option ${letter.toUpperCase()}`}
                  style={{ flex: 1 }}
                />
              </div>
            ))}
            <div className="form-hint">Click the radio button next to the correct answer.</div>
          </div>
        )}

        {/* Model answer for essay/short answer */}
        {(form.question_type === 'essay' || form.question_type === 'short_answer' || form.question_type === 'fill_blank') && (
          <div className="form-group" style={{ marginTop: 12 }}>
            <label>Model Answer / Marking Guide (optional)</label>
            <textarea rows="3" value={form.model_answer ?? ''}
              onChange={e => setForm({ ...form, model_answer: e.target.value })}
              placeholder="Expected answer or key points for marking" />
          </div>
        )}

        {/* True/False */}
        {form.question_type === 'true_false' && (
          <div className="form-group" style={{ marginTop: 12 }}>
            <label>Correct Answer</label>
            <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="radio" name="tf"
                  checked={form.correct_option === 'TRUE'}
                  onChange={() => setForm({ ...form, correct_option: 'TRUE' })}
                /> True
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="radio" name="tf"
                  checked={form.correct_option === 'FALSE'}
                  onChange={() => setForm({ ...form, correct_option: 'FALSE' })}
                /> False
              </label>
            </div>
          </div>
        )}

        <div className="form-group" style={{ marginTop: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.in_question_bank}
              onChange={e => setForm({ ...form, in_question_bank: e.target.checked })}
            />
            Save to Question Bank for reuse
          </label>
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Question'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Question Bank Panel ────────────────────────────────
function QuestionBankPanel() {
  const { classes, subjects } = useStore();
  const showToast = useStore(s => s.showToast);
  const [questions, setQuestions] = useState([]);
  const [filter, setFilter] = useState({ classId: '', subjectId: '', search: '', questionType: '', difficulty: '' });
  const [loading, setLoading] = useState(true);
  const [editingQuestion, setEditingQuestion] = useState(null);

  async function refresh() {
    setLoading(true);
    const list = await window.api.exams.listQuestions({
      classId: filter.classId || undefined,
      subjectId: filter.subjectId || undefined,
      questionType: filter.questionType || undefined,
      difficulty: filter.difficulty || undefined,
      search: filter.search || undefined,
      inBank: true,
    });
    setQuestions(list);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [filter]);

  async function deleteQ(id) {
    if (!confirm('Delete this question from the bank?')) return;
    await window.api.exams.deleteQuestion(id);
    showToast('Removed from bank', 'success');
    refresh();
  }

  return (
    <>
      <div className="card">
        <div className="section-header">
          <div>
            <div className="section-title">Question Bank ({questions.length})</div>
            <div className="text-sm text-muted">Reusable questions across all exam papers</div>
          </div>
          <button className="btn btn-primary" onClick={() => setEditingQuestion({})}>
            <IconPlus /> &nbsp;New Bank Question
          </button>
        </div>
        <div className="form-row" style={{ marginTop: 14 }}>
          <div className="form-group">
            <label>Class</label>
            <select value={filter.classId ?? ''} onChange={e => setFilter({ ...filter, classId: e.target.value })}>
              <option value="">All</option>
              {classes.map(c => <option key={c.id} value={c.id ?? ''}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Subject</label>
            <select value={filter.subjectId ?? ''} onChange={e => setFilter({ ...filter, subjectId: e.target.value })}>
              <option value="">All</option>
              {subjects.map(s => <option key={s.id} value={s.id ?? ''}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Type</label>
            <select value={filter.questionType ?? ''} onChange={e => setFilter({ ...filter, questionType: e.target.value })}>
              <option value="">All</option>
              <option value="essay">Essay</option>
              <option value="multiple_choice">Multiple Choice</option>
              <option value="short_answer">Short Answer</option>
              <option value="true_false">True/False</option>
              <option value="fill_blank">Fill Blank</option>
            </select>
          </div>
          <div className="form-group">
            <label>Difficulty</label>
            <select value={filter.difficulty ?? ''} onChange={e => setFilter({ ...filter, difficulty: e.target.value })}>
              <option value="">All</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label>Search</label>
            <input type="text" value={filter.search ?? ''}
              onChange={e => setFilter({ ...filter, search: e.target.value })}
              placeholder="Search question text..." />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        {loading ? <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
          : questions.length === 0
            ? <div className="empty-state">No questions in the bank yet. Start adding them above.</div>
            : <div className="question-list">
                {questions.map((q, i) => (
                  <div key={q.id} className="question-row">
                    <div className="question-num">{i + 1}.</div>
                    <div className="question-body">
                      <div className="question-type-row">
                        <span className="badge badge-primary">{q.question_type}</span>
                        <span className="badge badge-muted">{q.marks} marks</span>
                        <span className="badge badge-accent">{q.difficulty}</span>
                        {q.subject_name && <span className="badge badge-info">{q.subject_name}</span>}
                        {q.class_name && <span className="badge badge-muted">{q.class_name}</span>}
                      </div>
                      <div className="question-text" style={{ marginTop: 6 }}>{q.question_text}</div>
                    </div>
                    <div className="question-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditingQuestion(q)}>Edit</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => deleteQ(q.id)}>×</button>
                    </div>
                  </div>
                ))}
              </div>
        }
      </div>

      {editingQuestion !== null && (
        <QuestionEditorModal
          question={editingQuestion}
          paperId={null}
          classGroupId={editingQuestion.class_group_id || null}
          subjectId={editingQuestion.subject_id || null}
          onClose={() => setEditingQuestion(null)}
          onSaved={() => { setEditingQuestion(null); refresh(); }}
        />
      )}
    </>
  );
}

function IconPlus()     { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>; }
function IconDownload() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3v13M6 12l6 6 6-6M4 21h16" stroke="currentColor" strokeWidth="2" fill="none"/></svg>; }
