// Nickland Edusoft — Preload / API Bridge
// Copyright © 2026 Nickland Sales. All rights reserved.
const { contextBridge, ipcRenderer } = require('electron');

const api = {

  // ── Auth & Users ──────────────────────────────────────
  auth: {
    bootstrapStatus:           ()      => ipcRenderer.invoke('auth:bootstrap-status'),
    bootstrap:                 (data)  => ipcRenderer.invoke('auth:bootstrap', data),
    login:                     (data)  => ipcRenderer.invoke('auth:login', data),
    logout:                    (userId) => ipcRenderer.invoke('auth:logout', userId),
    listUsers:                 ()      => ipcRenderer.invoke('auth:list-users'),
    createUser:                (data)  => ipcRenderer.invoke('auth:create-user', data),
    updateUser:                (data)  => ipcRenderer.invoke('auth:update-user', data),
    resetPassword:             (data)  => ipcRenderer.invoke('auth:reset-password', data),
    effectivePermissions:      (userId) => ipcRenderer.invoke('auth:effective-permissions', userId),
    userOverrides:             (userId) => ipcRenderer.invoke('auth:user-overrides', userId),
    listUserAssignments:       (userId) => ipcRenderer.invoke('auth:list-user-assignments', userId),
    addUserAssignment:         (data)   => ipcRenderer.invoke('auth:add-user-assignment', data),
    removeUserAssignment:      (id)     => ipcRenderer.invoke('auth:remove-user-assignment', id),
    setPermissionOverride:     (data)  => ipcRenderer.invoke('auth:set-permission-override', data),
    listDesignations:          ()      => ipcRenderer.invoke('auth:list-designations'),
    getDesignationPermissions: (id)    => ipcRenderer.invoke('auth:get-designation-permissions', id),
    updateDesignationPermission:(data) => ipcRenderer.invoke('auth:update-designation-permission', data),
    changePassword:            (data)  => ipcRenderer.invoke('auth:change-password', data),
  },

  // ── Dashboard ─────────────────────────────────────────
  dashboard: {
    summary:           (termId)              => ipcRenderer.invoke('dashboard:summary', termId),
    todaySchedule:     ()                    => ipcRenderer.invoke('dashboard:today-schedule'),
  },

  // ── Students ──────────────────────────────────────────
  students: {
    list:              (filters)             => ipcRenderer.invoke('students:list', filters),
    get:               (id)                  => ipcRenderer.invoke('students:get', id),
    create:            (data)                => ipcRenderer.invoke('students:create', data),
    update:            (id, data)            => ipcRenderer.invoke('students:update', { id, data }),
    delete:            (id)                  => ipcRenderer.invoke('students:delete', id),
    bulkUpload:        (filePath)            => ipcRenderer.invoke('students:bulk-upload', filePath),
    bulkDownload:      (filters, savePath)   => ipcRenderer.invoke('students:bulk-download', { filters, savePath }),
    uploadPhoto:       (studentId, src)      => ipcRenderer.invoke('students:upload-photo', { studentId, sourcePath: src }),
    promote:           (mappings)            => ipcRenderer.invoke('students:promote', mappings),
    runInitialImport:  ()                    => ipcRenderer.invoke('students:run-initial-import'),
    generateAllIds:    ()                    => ipcRenderer.invoke('students:generate-all-ids'),
    listAttendance:    (studentId, termId)   => ipcRenderer.invoke('students:list-attendance', { studentId, termId }),
    listClassAttendance:(classId, date)     => ipcRenderer.invoke('students:list-class-attendance', { classId, date }),
    attendanceSummary: (studentId, termId)   => ipcRenderer.invoke('students:attendance-summary', { studentId, termId }),
    markAttendance:    (data)                => ipcRenderer.invoke('students:mark-attendance', data),
    markBulkAttendance:(data)               => ipcRenderer.invoke('students:mark-bulk-attendance', data),
    weeklyRegister:    (data)                => ipcRenderer.invoke('students:weekly-register', data),
    registerMark:      (data)                => ipcRenderer.invoke('students:register-mark', data),
    registerSaveReason:(data)                => ipcRenderer.invoke('students:register-save-reason', data),
    exportAttendanceRegisterExcel:(data)     => ipcRenderer.invoke('students:export-attendance-register-excel', data),
    exportAttendanceRegisterPdf:(data)       => ipcRenderer.invoke('students:export-attendance-register-pdf', data),
    listEvents:        (studentId)           => ipcRenderer.invoke('students:list-events', studentId),
    addEvent:          (data)                => ipcRenderer.invoke('students:add-event', data),
    deleteEvent:       (id)                  => ipcRenderer.invoke('students:delete-event', id),
    // Editable Sheet (WHONET-style)
    sheetData:         (filters)             => ipcRenderer.invoke('students:sheet-data', filters || {}),
    sheetColumns:      ()                    => ipcRenderer.invoke('students:sheet-columns'),
    sheetUpdateCell:   (data)                => ipcRenderer.invoke('students:sheet-update-cell', data),
    sheetBatchUpdate:  (data)                => ipcRenderer.invoke('students:sheet-batch-update', data),
  },

  // ── Staff ─────────────────────────────────────────────
  staff: {
    list:              (filters)             => ipcRenderer.invoke('staff:list', filters),
    get:               (id)                  => ipcRenderer.invoke('staff:get', id),
    create:            (data)                => ipcRenderer.invoke('staff:create', data),
    update:            (id, data)            => ipcRenderer.invoke('staff:update', { id, data }),
    delete:            (id)                  => ipcRenderer.invoke('staff:delete', id),
    uploadPhoto:       (staffId, src)        => ipcRenderer.invoke('staff:upload-photo', { staffId, sourcePath: src }),
    dashboard:         ()                    => ipcRenderer.invoke('staff:dashboard'),

    // Documents
    listDocuments:     (staffId)             => ipcRenderer.invoke('staff:list-documents', staffId),
    uploadDocument:    (data)                => ipcRenderer.invoke('staff:upload-document', data),
    deleteDocument:    (id)                  => ipcRenderer.invoke('staff:delete-document', id),

    // Medical
    getMedical:        (staffId)             => ipcRenderer.invoke('staff:get-medical', staffId),
    saveMedical:       (data)                => ipcRenderer.invoke('staff:save-medical', data),

    // Training
    listTraining:      (staffId)             => ipcRenderer.invoke('staff:list-training', staffId),
    saveTraining:      (data)                => ipcRenderer.invoke('staff:save-training', data),
    deleteTraining:    (id)                  => ipcRenderer.invoke('staff:delete-training', id),

    // Performance
    listPerformance:   (staffId)             => ipcRenderer.invoke('staff:list-performance', staffId),
    savePerformance:   (data)                => ipcRenderer.invoke('staff:save-performance', data),

    // Attendance / Clock-in
    clockinStatus:     ()                    => ipcRenderer.invoke('staff:clockin-status'),
    clockIn:           (staffId)             => ipcRenderer.invoke('staff:clock-in', staffId),
    clockOut:          (staffId)             => ipcRenderer.invoke('staff:clock-out', staffId),
    todayAttendance:   (staffId)             => ipcRenderer.invoke('staff:today-attendance', staffId),
    markAttendance:    (data)                => ipcRenderer.invoke('staff:mark-attendance', data),
    listAttendance:    (staffId, month, yr)  => ipcRenderer.invoke('staff:list-attendance', { staffId, month, year: yr }),

    // Leave
    listLeaveRequests: (filters)             => ipcRenderer.invoke('staff:list-leave', filters),
    submitLeaveRequest:(data)               => ipcRenderer.invoke('staff:submit-leave', data),
    reviewLeave:       (data)                => ipcRenderer.invoke('staff:review-leave', data),

    // Salary (legacy)
    listSalaries:      (staffId)             => ipcRenderer.invoke('staff:list-salaries', staffId),
    saveSalary:        (data)                => ipcRenderer.invoke('staff:save-salary', data),
    payrollSummary:    (month, year)         => ipcRenderer.invoke('staff:payroll-summary', { month, year }),
  },

  // ── Payroll ───────────────────────────────────────────
  payroll: {
    calculate:         (data)                => ipcRenderer.invoke('payroll:calculate', data),
    bulkPreview:       (month, year)         => ipcRenderer.invoke('payroll:bulk-preview', { month, year }),
    bulkRun:           (month, year, dt)     => ipcRenderer.invoke('payroll:bulk-run', { month, year, paymentDate: dt }),
    markPaid:          (data)                => ipcRenderer.invoke('payroll:mark-paid', data),
    ytdSummary:        (staffId, year)       => ipcRenderer.invoke('payroll:ytd-summary', { staffId, year }),
    ssnitSchedule:     (month, year)         => ipcRenderer.invoke('payroll:ssnit-schedule', { month, year }),
    payeSchedule:      (month, year)         => ipcRenderer.invoke('payroll:paye-schedule', { month, year }),
    payslipData:       (salaryId)            => ipcRenderer.invoke('payroll:payslip-data', salaryId),
  },

  // ── Mobile Sync (scaffold — companion app not yet released) ──
  mobileSync: {
    generateToken:     ()                    => ipcRenderer.invoke('mobile-sync:generate-token'),
    status:            ()                    => ipcRenderer.invoke('mobile-sync:status'),
    revokeDevice:      (deviceId)            => ipcRenderer.invoke('mobile-sync:revoke-device', deviceId),
    testServer:        ()                    => ipcRenderer.invoke('mobile-sync:test-server'),
  },

  // ── Discounts ─────────────────────────────────────────
  discounts: {
    list:              (filters)             => ipcRenderer.invoke('discounts:list', filters || {}),
    getForStudent:     (studentId)           => ipcRenderer.invoke('discounts:get-for-student', studentId),
    save:              (data)                => ipcRenderer.invoke('discounts:save', data),
    revoke:            (data)                => ipcRenderer.invoke('discounts:revoke', data),
    compute:           (data)                => ipcRenderer.invoke('discounts:compute', data),
  },

  // ── Books ─────────────────────────────────────────────
  books: {
    list:              (filters)             => ipcRenderer.invoke('books:list', filters || {}),
    get:               (data)                => ipcRenderer.invoke('books:get', data),
    save:              (data)                => ipcRenderer.invoke('books:save', data),
    generateForClass:  (data)                => ipcRenderer.invoke('books:generate-for-class', data),
    recordPayment:     (data)                => ipcRenderer.invoke('books:record-payment', data),
    classPaymentSheet: (data)                => ipcRenderer.invoke('books:class-payment-sheet', data),
  },

  // ── Fees Bulk Pay ─────────────────────────────────────
  feesBulkPay: {
    sheet:             (data)                => ipcRenderer.invoke('fees:bulk-pay-sheet', data),
    record:            (data)                => ipcRenderer.invoke('fees:bulk-pay-record', data),
  },

  // ── Inventory ─────────────────────────────────────────
  inventory: {
    listItems:         (filters)             => ipcRenderer.invoke('inventory:list-items', filters || {}),
    getItem:           (id)                  => ipcRenderer.invoke('inventory:get-item', id),
    saveItem:          (data)                => ipcRenderer.invoke('inventory:save-item', data),
    recordMovement:    (data)                => ipcRenderer.invoke('inventory:record-movement', data),
    dashboard:         ()                    => ipcRenderer.invoke('inventory:dashboard'),
    categories:        ()                    => ipcRenderer.invoke('inventory:categories'),
  },

  // ── Audit Log ─────────────────────────────────────────
  audit: {
    log:               (data)                => ipcRenderer.invoke('audit:log', data),
    list:              (filters)             => ipcRenderer.invoke('audit:list', filters || {}),
  },

  // ── Receipt Templates ─────────────────────────────────
  receipts: {
    listTemplates:     (filters)             => ipcRenderer.invoke('receipts:list-templates', filters || {}),
    uploadTemplate:    (data)                => ipcRenderer.invoke('receipts:upload-template', data),
    setDefault:        (data)                => ipcRenderer.invoke('receipts:set-default', data),
    deleteTemplate:    (id)                  => ipcRenderer.invoke('receipts:delete-template', id),
    availableTags:     (templateType)        => ipcRenderer.invoke('receipts:available-tags', templateType),
    generate:          (data)                => ipcRenderer.invoke('receipts:generate', data),
  },

  // ── Photos ────────────────────────────────────────────
  photos: {
    upload:            (data)                => ipcRenderer.invoke('photos:upload', data),
    remove:            (data)                => ipcRenderer.invoke('photos:remove', data),
  },

  // ── Lesson Notes ─────────────────────────────────────
  lessonNotes: {
    list:              (filters)             => ipcRenderer.invoke('lesson-notes:list', filters),
    get:               (id)                  => ipcRenderer.invoke('lesson-notes:get', id),
    save:              (data)                => ipcRenderer.invoke('lesson-notes:save', data),
    delete:            (id)                  => ipcRenderer.invoke('lesson-notes:delete', id),
    review:            (data)                => ipcRenderer.invoke('lesson-notes:review', data),
  },

  // ── Staff Activities ─────────────────────────────────
  staffActivities: {
    list:              (filters)             => ipcRenderer.invoke('staff-activities:list', filters),
    save:              (data)                => ipcRenderer.invoke('staff-activities:save', data),
    delete:            (id)                  => ipcRenderer.invoke('staff-activities:delete', id),
    acknowledge:       (id)                  => ipcRenderer.invoke('staff-activities:acknowledge', id),
    summary:           (data)                => ipcRenderer.invoke('staff-activities:summary', data),
  },

  // ── Fees ─────────────────────────────────────────────
  fees: {
    listTemplates:     ()                    => ipcRenderer.invoke('fees:list-templates'),
    getTemplate:       (id)                  => ipcRenderer.invoke('fees:get-template', id),
    saveTemplate:      (data)                => ipcRenderer.invoke('fees:save-template', data),
    deleteTemplate:    (id)                  => ipcRenderer.invoke('fees:delete-template', id),
    generateBill:      (studentId, termId)   => ipcRenderer.invoke('fees:generate-bill', { studentId, termId }),
    generateBillsBulk: (scope)               => ipcRenderer.invoke('fees:generate-bulk', scope),
    listBills:         (filters)             => ipcRenderer.invoke('fees:list-bills', filters),
    getBill:           (id)                  => ipcRenderer.invoke('fees:get-bill', id),
    recordPayment:     (data)                => ipcRenderer.invoke('fees:record-payment', data),
    listPayments:      (studentId, termId)   => ipcRenderer.invoke('fees:list-payments', { studentId, termId }),
    debtorsReport:     (termId)              => ipcRenderer.invoke('fees:debtors-report', termId),
    dashboard:         (termId)              => ipcRenderer.invoke('fees:dashboard', termId),
    expectedIncome:    (termId)              => ipcRenderer.invoke('fees:expected-income', termId),
    studentFinProfile: (studentId)           => ipcRenderer.invoke('fees:student-financial-profile', studentId),
  },

  // ── Academics / Scores ────────────────────────────────
  scores: {
    listForClass:      (classId, termId)     => ipcRenderer.invoke('scores:list-for-class', { classId, termId }),
    saveBulk:          (payload)             => ipcRenderer.invoke('scores:save-bulk', payload),
    getStudentReport:  (studentId, termId)   => ipcRenderer.invoke('scores:student-report', { studentId, termId }),
    getStudentCumulative:(studentId)         => ipcRenderer.invoke('scores:student-cumulative', studentId),
    listSubjects:      ()                    => ipcRenderer.invoke('scores:list-subjects'),
    getWeights:        ()                    => ipcRenderer.invoke('scores:get-weights'),
    listAssessmentColumns: (data)            => ipcRenderer.invoke('scores:list-assessment-columns', data),
    addAssessmentColumn:   (data)            => ipcRenderer.invoke('scores:add-assessment-column', data),
    updateAssessmentColumn:(data)            => ipcRenderer.invoke('scores:update-assessment-column', data),
    deleteAssessmentColumn:(id)              => ipcRenderer.invoke('scores:delete-assessment-column', id),
    classSheet:        (data)                => ipcRenderer.invoke('scores:class-sheet', data),
    saveAssessmentMark:(data)                => ipcRenderer.invoke('scores:save-assessment-mark', data),
    examSheet:         (data)                => ipcRenderer.invoke('scores:exam-sheet', data),
    saveExamMark:      (data)                => ipcRenderer.invoke('scores:save-exam-mark', data),
    endOfTerm:         (data)                => ipcRenderer.invoke('scores:end-of-term', data),
    assessmentCompilationSheet:(data)        => ipcRenderer.invoke('scores:assessment-compilation-sheet', data),
    saveAssessmentCompilation:(data)         => ipcRenderer.invoke('scores:save-assessment-compilation', data),
    rankClass:         (payload)             => ipcRenderer.invoke('scores:rank-class', payload),
    listComponents:    (classId, termId)     => ipcRenderer.invoke('scores:list-components', { classId, termId }),
    saveComponents:    (data)                => ipcRenderer.invoke('scores:save-components', data),
    saveTermSummary:   (data)                => ipcRenderer.invoke('scores:save-term-summary', data),
    getTermSummary:    (studentId, termId)   => ipcRenderer.invoke('scores:get-term-summary', { studentId, termId }),
  },

  // ── Academics dashboard ──────────────────────────────
  academics: {
    dashboard:         (termId)              => ipcRenderer.invoke('academics:dashboard', termId),
  },

  // ── Examinations ─────────────────────────────────────
  exams: {
    listPapers:        (filters)             => ipcRenderer.invoke('exams:list-papers', filters),
    getPaper:          (id)                  => ipcRenderer.invoke('exams:get-paper', id),
    savePaper:         (data)                => ipcRenderer.invoke('exams:save-paper', data),
    deletePaper:       (id)                  => ipcRenderer.invoke('exams:delete-paper', id),
    listSections:      (paperId)             => ipcRenderer.invoke('exams:list-sections', paperId),
    saveSection:       (data)                => ipcRenderer.invoke('exams:save-section', data),
    deleteSection:     (id)                  => ipcRenderer.invoke('exams:delete-section', id),
    listQuestions:     (filters)             => ipcRenderer.invoke('exams:list-questions', filters),
    saveQuestion:      (data)                => ipcRenderer.invoke('exams:save-question', data),
    deleteQuestion:    (id)                  => ipcRenderer.invoke('exams:delete-question', id),
    reorderQuestions:  (data)                => ipcRenderer.invoke('exams:reorder-questions', data),
    copyFromBank:      (data)                => ipcRenderer.invoke('exams:copy-from-bank', data),
    paperStats:        (paperId)             => ipcRenderer.invoke('exams:paper-stats', paperId),
    exportPaper:       (paperId, options)    => ipcRenderer.invoke('reports:generate-exam-paper', { paperId, options }),
    importFromTemplate:(filePath)            => ipcRenderer.invoke('exams:import-template', filePath),
  },

  // ── Canteen ───────────────────────────────────────────
  canteen: {
    getStudentProfile: (studentId, termId)   => ipcRenderer.invoke('canteen:student-profile', { studentId, termId }),
    recordPayment:     (data)                => ipcRenderer.invoke('canteen:record-payment', data),
    markDaysPaid:      (data)                => ipcRenderer.invoke('canteen:mark-days-paid', data),
    markBulkPaid:      (data)                => ipcRenderer.invoke('canteen:mark-bulk-paid', data),
    markExempt:        (data)                => ipcRenderer.invoke('canteen:mark-exempt', data),
    applyAttendanceExemption: (data)         => ipcRenderer.invoke('canteen:apply-attendance-exemption', data),
    classRosterForDate:(classId, date)       => ipcRenderer.invoke('canteen:class-roster-for-date', { classId, date }),
    classRosterForRange:(classId, dates)     => ipcRenderer.invoke('canteen:class-roster-for-range', { classId, dates }),
    setDayStatus:      (data)                => ipcRenderer.invoke('canteen:set-day-status', data),
    listCalendar:      (termId)              => ipcRenderer.invoke('canteen:list-calendar', termId),
    saveCalendarDay:   (data)                => ipcRenderer.invoke('canteen:save-calendar-day', data),
    setupTermCalendar: (data)                => ipcRenderer.invoke('canteen:setup-term-calendar', data),
    debtorsReport:     (termId)              => ipcRenderer.invoke('canteen:debtors-report', termId),
    dashboard:         (termId)              => ipcRenderer.invoke('canteen:dashboard', termId),
  },

  // ── Finance ───────────────────────────────────────────
  finance: {
    dashboard:         (termId)              => ipcRenderer.invoke('finance:dashboard', termId),
    listIncome:        (filters)             => ipcRenderer.invoke('finance:list-income', filters),
    recordIncome:      (data)                => ipcRenderer.invoke('finance:record-income', data),
    updateIncome:      (id, data)            => ipcRenderer.invoke('finance:update-income', { id, data }),
    deleteIncome:      (data)                => ipcRenderer.invoke('finance:delete-income', data),
    listExpense:       (filters)             => ipcRenderer.invoke('finance:list-expense', filters),
    recordExpense:     (data)                => ipcRenderer.invoke('finance:record-expense', data),
    updateExpense:     (id, data)            => ipcRenderer.invoke('finance:update-expense', { id, data }),
    deleteExpense:     (data)                => ipcRenderer.invoke('finance:delete-expense', data),
    summary:           (termId)              => ipcRenderer.invoke('finance:summary', termId),
    financialStatement:(params)              => ipcRenderer.invoke('finance:financial-statement', params),
    expectedIncome:    (termId)              => ipcRenderer.invoke('finance:expected-income', termId),
    listBudgets:       (filters)             => ipcRenderer.invoke('finance:list-budgets', filters),
    getBudget:         (id)                  => ipcRenderer.invoke('finance:get-budget', id),
    saveBudget:        (data)                => ipcRenderer.invoke('finance:save-budget', data),
    deleteBudget:      (id)                  => ipcRenderer.invoke('finance:delete-budget', id),
    saveBudgetItem:    (data)                => ipcRenderer.invoke('finance:save-budget-item', data),
    deleteBudgetItem:  (id)                  => ipcRenderer.invoke('finance:delete-budget-item', id),
  },

  // ── Reports / Printing ────────────────────────────────
  reports: {
    generateReportCards: (params)            => ipcRenderer.invoke('reports:generate-report-cards', params),
    renderCardHtml:      (data)              => ipcRenderer.invoke('reports:render-card-html', data),
    generateBillsPdf:    (params)            => ipcRenderer.invoke('reports:generate-bills-pdf', params),
    generatePayslip:     (salaryId, opts)    => ipcRenderer.invoke('reports:generate-payslip', { salaryId, options: opts }),
    generateReceipt:     (paymentId, opts)   => ipcRenderer.invoke('reports:generate-receipt', { paymentId, options: opts }),
    generateStudentProfile: (studentId, opts) => ipcRenderer.invoke('reports:generate-student-profile', { studentId, options: opts }),
    generateAttestation: (studentId, kind, opts) => ipcRenderer.invoke('reports:generate-attestation', { studentId, kind, options: opts }),
    generateDebtorsList: (termId, opts)      => ipcRenderer.invoke('reports:debtors-list', { termId, options: opts }),
    generateClassList:   (classId, opts)     => ipcRenderer.invoke('reports:class-list', { classId, options: opts }),
    printToPdf:          (html, opts)        => ipcRenderer.invoke('reports:print-to-pdf', { html, options: opts }),
  },

  // ── Settings ──────────────────────────────────────────
  settings: {
    getAll:            ()                    => ipcRenderer.invoke('settings:get-all'),
    set:               (key, value)          => ipcRenderer.invoke('settings:set', { key, value }),
    uploadLogo:        (src)                 => ipcRenderer.invoke('settings:upload-logo', src),
    uploadSignature:   (data)                => ipcRenderer.invoke('settings:upload-signature', data),
    removeSignature:   (role)                => ipcRenderer.invoke('settings:remove-signature', role),
    getSignatureForUse:(data)                => ipcRenderer.invoke('settings:get-signature-for-use', data),
    listClasses:       ()                    => ipcRenderer.invoke('settings:list-classes'),
    saveClass:         (data)                => ipcRenderer.invoke('settings:save-class', data),
    deleteClass:       (id)                  => ipcRenderer.invoke('settings:delete-class', id),
    listTerms:         ()                    => ipcRenderer.invoke('settings:list-terms'),
    saveTerm:          (data)                => ipcRenderer.invoke('settings:save-term', data),
    setCurrentTerm:    (id)                  => ipcRenderer.invoke('settings:set-current-term', id),
    listAcademicYears: ()                    => ipcRenderer.invoke('settings:list-academic-years'),
    saveAcademicYear:  (data)                => ipcRenderer.invoke('settings:save-academic-year', data),
    listGradingBands:  ()                    => ipcRenderer.invoke('settings:list-grading-bands'),
    saveGradingBands:  (bands)               => ipcRenderer.invoke('settings:save-grading-bands', bands),
    listSubjects:      ()                    => ipcRenderer.invoke('settings:list-subjects'),
    saveSubject:       (data)                => ipcRenderer.invoke('settings:save-subject', data),
    deleteSubject:     (id)                  => ipcRenderer.invoke('settings:delete-subject', id),
    getClassSubjects:  (classId)             => ipcRenderer.invoke('settings:get-class-subjects', classId),
    setClassSubjects:  (classId, ids)        => ipcRenderer.invoke('settings:set-class-subjects', { classId, subjectIds: ids }),
  },

  // ── Notifications ─────────────────────────────────────
  notifications: {
    send:              (data)                => ipcRenderer.invoke('notifications:send', data),
    sendBulk:          (data)                => ipcRenderer.invoke('notifications:send-bulk', data),
    listLog:           (filters)             => ipcRenderer.invoke('notifications:list-log', filters),
    getTemplates:      ()                    => ipcRenderer.invoke('notifications:get-templates'),
    saveTemplate:      (data)                => ipcRenderer.invoke('notifications:save-template', data),
  },

  // ── App-level ─────────────────────────────────────────
  app: {
    getPaths:          ()                    => ipcRenderer.invoke('app:get-paths'),
    showOpenDialog:    (opts)                => ipcRenderer.invoke('app:show-open-dialog', opts),
    showSaveDialog:    (opts)                => ipcRenderer.invoke('app:show-save-dialog', opts),
    openFolder:        (fp)                  => ipcRenderer.invoke('app:open-folder', fp),
    openFile:          (fp)                  => ipcRenderer.invoke('app:open-file', fp),
    openPdfPreview:    (fp)                  => ipcRenderer.invoke('app:open-pdf-preview', fp),
    printToPdf:        (opts)                => ipcRenderer.invoke('app:print-to-pdf', opts),
  },
};

contextBridge.exposeInMainWorld('api', api);
