// Nickland Edusoft — Printable Student Profile
// Full single-page document — every detail + photo + school header + signatures
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../../store/index.js';
import { fullName, fmtDate, displayAge } from '../../lib/format.js';
import { previewStudentProfile, previewAttestation } from '../../lib/printHelpers.js';

export default function PrintableProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings, currentUser } = useStore();
  const [student, setStudent] = useState(null);
  const [propSig, setPropSig] = useState(null);
  const [headSig, setHeadSig] = useState(null);
  const [loading, setLoading] = useState(true);

  const school = settings.school || {};
  const reg = settings.registration || {};
  const branding = settings.branding || {};
  const sigs = settings.signatures || {};
  const logoPath = branding.school_logo_path;
  const logoSrc = logoPath ? `file://${logoPath}` : null;

  useEffect(() => {
    (async () => {
      const s = await window.api.students.get(parseInt(id));
      setStudent(s);

      // Attempt to load each signature — server enforces access control
      if (sigs.embed_proprietor_signature === 'true' && sigs.proprietor_signature_path) {
        const res = await window.api.settings.getSignatureForUse({
          role: 'proprietor',
          currentUserId: currentUser?.id,
        });
        if (res.ok) setPropSig(res);
      }
      if (sigs.embed_headmaster_signature === 'true' && sigs.headmaster_signature_path) {
        const res = await window.api.settings.getSignatureForUse({
          role: 'headmaster',
          currentUserId: currentUser?.id,
        });
        if (res.ok) setHeadSig(res);
      }
      setLoading(false);
    })();
  }, [id]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;
  if (!student) return <div className="text-muted">Student not found</div>;

  return (
    <div className="printable-page-wrap">
      {/* Toolbar — hidden on print */}
      <div className="print-toolbar no-print">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/students/${id}`)}>← Back to Profile</button>
        <div style={{ flex: 1 }}></div>
        <button className="btn btn-outline" onClick={async () => {
          const r = await previewAttestation(parseInt(id), 'attestation');
          if (!r.ok) useStore.getState().showToast(r.error, 'error');
        }}>📜 Attestation</button>
        <button className="btn btn-outline" onClick={async () => {
          const r = await previewAttestation(parseInt(id), 'testimonial');
          if (!r.ok) useStore.getState().showToast(r.error, 'error');
        }}>📝 Testimonial</button>
        <button className="btn btn-primary" onClick={async () => {
          const r = await previewStudentProfile(parseInt(id));
          if (!r.ok) useStore.getState().showToast(r.error, 'error');
        }}>
          🖨 Print Profile (PDF)
        </button>
      </div>

      {/* The printable document */}
      <div className="printable-page">
        {/* School header */}
        <div className="print-header">
          {logoSrc && <img src={logoSrc} alt="" className="print-logo" />}
          <div className="print-school-block">
            <h1 className="print-school-name">{(school.school_name || 'School').toUpperCase()}</h1>
            {school.school_motto && <div className="print-school-motto">"{school.school_motto}"</div>}
            <div className="print-school-meta">
              {school.school_address && <div>{school.school_address}</div>}
              <div>
                {school.school_phone_1 && <span>Tel: {school.school_phone_1}</span>}
                {school.school_email && <span> · Email: {school.school_email}</span>}
              </div>
            </div>
          </div>
        </div>

        <div className="print-divider"></div>

        <div className="print-title">STUDENT PROFILE</div>

        {/* Photo + basic identity */}
        <div className="print-identity-block">
          <div className="print-photo">
            {student.photo_path
              ? <img src={`file://${student.photo_path}`} alt="" />
              : <div className="print-photo-placeholder">
                  <span>Photo</span>
                </div>
            }
          </div>
          <div className="print-identity-info">
            <h2 className="print-student-name">{fullName(student).toUpperCase()}</h2>
            <table className="print-identity-table">
              <tbody>
                <tr><td>Index Number:</td><td><strong>{student.index_number || '—'}</strong></td></tr>
                <tr><td>Class:</td><td>{student.class_name || '—'}</td></tr>
                <tr><td>Status:</td><td>{student.status}</td></tr>
                <tr><td>Date of Admission:</td><td>{student.admission_date ? fmtDate(student.admission_date) : '—'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Personal details */}
        <SectionBlock title="Personal Details">
          <DetailRow label="Surname" value={student.surname ?? ''} />
          <DetailRow label="First Name" value={student.first_name ?? ''} />
          <DetailRow label="Other Names" value={student.other_names ?? ''} />
          <DetailRow label="Gender" value={student.gender ?? ''} />
          <DetailRow label="Date of Birth" value={student.date_of_birth ? fmtDate(student.date_of_birth) : null} />
          <DetailRow label="Age" value={displayAge(student)} />
          <DetailRow label="Denomination" value={student.denomination ?? ''} />
          <DetailRow label="Place of Birth" value={student.place_of_birth ?? ''} />
          <DetailRow label="NHIS Number" value={student.nhis_number ?? ''} />
        </SectionBlock>

        {/* Address */}
        <SectionBlock title="Address">
          <DetailRow label="Place of Residence" value={student.place_of_residence ?? ''} />
          <DetailRow label="Street" value={student.street_address ?? ''} />
          <DetailRow label="House Number" value={student.house_number ?? ''} />
          <DetailRow label="Digital (GPS) Address" value={student.digital_address ?? ''} />
        </SectionBlock>

        {/* Parents / Guardian */}
        <SectionBlock title="Parents & Guardian">
          <DetailRow label="Father's Name" value={student.father_name ?? ''} />
          <DetailRow label="Father's Contact" value={student.father_contact ?? ''} />
          <DetailRow label="Mother's Name" value={student.mother_name ?? ''} />
          <DetailRow label="Mother's Contact" value={student.mother_contact ?? ''} />
          <DetailRow label="Guardian's Name" value={student.guardian_name ?? ''} />
          <DetailRow label="Guardian's Contact" value={student.guardian_contact ?? ''} />
        </SectionBlock>

        {student.notes && (
          <SectionBlock title="Notes">
            <div className="print-notes">{student.notes}</div>
          </SectionBlock>
        )}

        {/* Footer with signatures */}
        <div className="print-footer">
          <div className="print-signature-grid">
            <SignatureBlock
              label="Proprietor"
              name={sigs.proprietor_name}
              signature={propSig}
            />
            <SignatureBlock
              label="Headmaster / Head Teacher"
              name={sigs.headmaster_name}
              signature={headSig}
            />
          </div>

          <div className="print-footer-meta">
            Generated on {fmtDate(new Date().toISOString())} ·
            {' '}This is an official record of {school.school_name || 'the school'} ·
            {' '}Powered by Nickland Edusoft
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionBlock({ title, children }) {
  return (
    <div className="print-section">
      <h3 className="print-section-title">{title}</h3>
      <table className="print-section-table">
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <tr>
      <td className="print-label">{label}</td>
      <td className="print-value">{value || '—'}</td>
    </tr>
  );
}

function SignatureBlock({ label, name, signature }) {
  return (
    <div className="signature-block">
      {signature?.path
        ? <img src={`file://${signature.path}`} alt="" className="signature-image" />
        : <div className="signature-spacer"></div>
      }
      <div className="signature-line"></div>
      <div className="signature-name">{name || '—'}</div>
      <div className="signature-label">{label}</div>
    </div>
  );
}
