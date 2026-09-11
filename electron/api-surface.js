// Nickland Edusoft — the application's API surface, in one place.
// Copyright © 2026 Nickland Sales. All rights reserved.
//
// Every call the application can make, named once. The office application in
// its own window and the same application in a browser are not two products,
// and must not be two lists: a channel added here reaches both, and a channel
// that reaches only one is a fault somebody finds months later, on the one PC
// that has it.
//
// It knows nothing about how a call travels. buildApi(invoke) is handed the
// transport and returns the object the screens are written against:
//
//   electron/preload.js            invoke → ipcRenderer.invoke, over Electron IPC
//   src/renderer/src/lib/desk.js   invoke → a POST to the host, over the network
//
// That is the whole of the difference between the installed application and
// the same application in a browser. 467 call sites across 94 screens are
// written against this shape and not one of them knows which carried it.

function buildApi(invoke) {
  const api = {

    // ── Auth & Users ──────────────────────────────────────
    auth: {
      bootstrapStatus:           ()      => invoke('auth:bootstrap-status'),
      bootstrap:                 (data)  => invoke('auth:bootstrap', data),
      login:                     (data)  => invoke('auth:login', data),
      logout:                    (userId) => invoke('auth:logout', userId),
      listUsers:                 ()      => invoke('auth:list-users'),
      createUser:                (data)  => invoke('auth:create-user', data),
      updateUser:                (data)  => invoke('auth:update-user', data),
      resetPassword:             (data)  => invoke('auth:reset-password', data),
      effectivePermissions:      (userId) => invoke('auth:effective-permissions', userId),
      userOverrides:             (userId) => invoke('auth:user-overrides', userId),
      listUserAssignments:       (userId) => invoke('auth:list-user-assignments', userId),
      classTeachers:             ()      => invoke('auth:class-teachers'),
      addUserAssignment:         (data)   => invoke('auth:add-user-assignment', data),
      removeUserAssignment:      (id)     => invoke('auth:remove-user-assignment', id),
      setPermissionOverride:     (data)  => invoke('auth:set-permission-override', data),
      listDesignations:          ()      => invoke('auth:list-designations'),
      getDesignationPermissions: (id)    => invoke('auth:get-designation-permissions', id),
      updateDesignationPermission:(data) => invoke('auth:update-designation-permission', data),
      changePassword:            (data)  => invoke('auth:change-password', data),
      // Password reset by approval — see electron/ipc/auth.js. Raising a request
      // and redeeming a claim are both reachable before sign-in, by design.
      requestPasswordReset:      (data)  => invoke('auth:request-password-reset', data),
      passwordResetStatus:       (data)  => invoke('auth:password-reset-status', data),
      completePasswordReset:     (data)  => invoke('auth:complete-password-reset', data),
      listPasswordResets:        (data)  => invoke('auth:list-password-resets', data || {}),
      pendingPasswordResets:     ()      => invoke('auth:pending-password-resets'),
      decidePasswordReset:       (data)  => invoke('auth:decide-password-reset', data),
    },

    // ── Access control (roles + per-person overrides, level-based) ────────
    access: {
      catalogue:      ()      => invoke('access:catalogue'),
      roleMatrix:     ()      => invoke('access:role-matrix'),
      setRoleLevel:   (data)  => invoke('access:set-role-level', data),
      setRoleAll:     (data)  => invoke('access:set-role-all', data),
      createRole:     (data)  => invoke('access:create-role', data),
      updateRole:     (data)  => invoke('access:update-role', data),
      deleteRole:     (data)  => invoke('access:delete-role', data),
      userAccess:     (userId) => invoke('access:user-access', userId),
      setUserLevel:   (data)  => invoke('access:set-user-level', data),
      resetUser:      (data)  => invoke('access:reset-user', data),
    },

    // ── Dashboard ─────────────────────────────────────────
    dashboard: {
      summary:           (termId)              => invoke('dashboard:summary', termId),
      todaySchedule:     ()                    => invoke('dashboard:today-schedule'),
    },

    // ── Students ──────────────────────────────────────────
    students: {
      list:              (filters)             => invoke('students:list', filters),
      get:               (id)                  => invoke('students:get', id),
      create:            (data)                => invoke('students:create', data),
      update:            (id, data)            => invoke('students:update', { id, data }),
      delete:            (id)                  => invoke('students:delete', id),
      bulkUpload:        (filePath)            => invoke('students:bulk-upload', filePath),
      bulkPreview:       (filePath)            => invoke('students:bulk-preview', filePath),
      bulkCommit:        (rows)                => invoke('students:bulk-commit', { rows }),
      bulkDownload:      (filters, savePath)   => invoke('students:bulk-download', { filters, savePath }),
      uploadPhoto:       (studentId, src)      => invoke('students:upload-photo', { studentId, sourcePath: src }),
      promote:           (mappings)            => invoke('students:promote', mappings),
      runInitialImport:  ()                    => invoke('students:run-initial-import'),
      generateAllIds:    ()                    => invoke('students:generate-all-ids'),
      listAttendance:    (studentId, termId)   => invoke('students:list-attendance', { studentId, termId }),
      listClassAttendance:(classId, date)     => invoke('students:list-class-attendance', { classId, date }),
      attendanceSummary: (studentId, termId)   => invoke('students:attendance-summary', { studentId, termId }),
      markAttendance:    (data)                => invoke('students:mark-attendance', data),
      markBulkAttendance:(data)               => invoke('students:mark-bulk-attendance', data),
      weeklyRegister:    (data)                => invoke('students:weekly-register', data),
      registerMark:      (data)                => invoke('students:register-mark', data),
      registerSaveReason:(data)                => invoke('students:register-save-reason', data),
      exportAttendanceRegisterExcel:(data)     => invoke('students:export-attendance-register-excel', data),
      exportAttendanceRegisterPdf:(data)       => invoke('students:export-attendance-register-pdf', data),
      listEvents:        (studentId)           => invoke('students:list-events', studentId),
      addEvent:          (data)                => invoke('students:add-event', data),
      deleteEvent:       (id)                  => invoke('students:delete-event', id),
      // Editable Sheet (WHONET-style)
      sheetData:         (filters)             => invoke('students:sheet-data', filters || {}),
      sheetColumns:      ()                    => invoke('students:sheet-columns'),
      sheetUpdateCell:   (data)                => invoke('students:sheet-update-cell', data),
      sheetBatchUpdate:  (data)                => invoke('students:sheet-batch-update', data),
    },

    // ── Staff ─────────────────────────────────────────────
    staff: {
      list:              (filters)             => invoke('staff:list', filters),
      get:               (id)                  => invoke('staff:get', id),
      create:            (data)                => invoke('staff:create', data),
      update:            (id, data)            => invoke('staff:update', { id, data }),
      delete:            (id)                  => invoke('staff:delete', id),
      uploadPhoto:       (staffId, src)        => invoke('staff:upload-photo', { staffId, sourcePath: src }),
      dashboard:         ()                    => invoke('staff:dashboard'),

      // Documents
      listDocuments:     (staffId)             => invoke('staff:list-documents', staffId),
      uploadDocument:    (data)                => invoke('staff:upload-document', data),
      deleteDocument:    (id)                  => invoke('staff:delete-document', id),

      // Medical
      getMedical:        (staffId)             => invoke('staff:get-medical', staffId),
      saveMedical:       (data)                => invoke('staff:save-medical', data),

      // Training
      listTraining:      (staffId)             => invoke('staff:list-training', staffId),
      saveTraining:      (data)                => invoke('staff:save-training', data),
      deleteTraining:    (id)                  => invoke('staff:delete-training', id),

      // Performance
      listPerformance:   (staffId)             => invoke('staff:list-performance', staffId),
      savePerformance:   (data)                => invoke('staff:save-performance', data),

      // Attendance / Clock-in
      clockinStatus:     ()                    => invoke('staff:clockin-status'),
      clockIn:           (staffId)             => invoke('staff:clock-in', staffId),
      clockOut:          (staffId)             => invoke('staff:clock-out', staffId),
      todayAttendance:   (staffId)             => invoke('staff:today-attendance', staffId),
      markAttendance:    (data)                => invoke('staff:mark-attendance', data),
      listAttendance:    (staffId, month, yr)  => invoke('staff:list-attendance', { staffId, month, year: yr }),

      // Leave
      listLeaveRequests: (filters)             => invoke('staff:list-leave', filters),
      submitLeaveRequest:(data)               => invoke('staff:submit-leave', data),
      reviewLeave:       (data)                => invoke('staff:review-leave', data),

      // Salary (legacy)
      listSalaries:      (staffId)             => invoke('staff:list-salaries', staffId),
      saveSalary:        (data)                => invoke('staff:save-salary', data),
      payrollSummary:    (month, year)         => invoke('staff:payroll-summary', { month, year }),
    },

    // ── Payroll ───────────────────────────────────────────
    payroll: {
      calculate:         (data)                => invoke('payroll:calculate', data),
      bulkPreview:       (month, year)         => invoke('payroll:bulk-preview', { month, year }),
      bulkRun:           (month, year, dt)     => invoke('payroll:bulk-run', { month, year, paymentDate: dt }),
      markPaid:          (data)                => invoke('payroll:mark-paid', data),
      ytdSummary:        (staffId, year)       => invoke('payroll:ytd-summary', { staffId, year }),
      ssnitSchedule:     (month, year)         => invoke('payroll:ssnit-schedule', { month, year }),
      payeSchedule:      (month, year)         => invoke('payroll:paye-schedule', { month, year }),
      payslipData:       (salaryId)            => invoke('payroll:payslip-data', salaryId),
      paidSummary:       (termId)              => invoke('payroll:paid-summary', { termId }),
    },

    // ── Mobile Sync (scaffold — companion app not yet released) ──
    mobileSync: {
      generateToken:     ()                    => invoke('mobile-sync:generate-token'),
      status:            ()                    => invoke('mobile-sync:status'),
      revokeDevice:      (deviceId)            => invoke('mobile-sync:revoke-device', deviceId),
      testServer:        ()                    => invoke('mobile-sync:test-server'),
    },

    // ── Mobile API host (embedded server for the mobile client) ──
    mobile: {
      status:            ()                    => invoke('mobile:status'),
      start:             ()                    => invoke('mobile:start'),
      stop:              ()                    => invoke('mobile:stop'),
      setConfig:         (data)                => invoke('mobile:set-config', data),
      listDevices:       ()                    => invoke('mobile:list-devices'),
      revokeDevice:      (id)                  => invoke('mobile:revoke-device', id),
      listParents:       ()                    => invoke('mobile:list-parents'),
      createParent:      (data)                => invoke('mobile:create-parent', data),
      resetParent:       (data)                => invoke('mobile:reset-parent', data),
      revokeParent:      (parentId)            => invoke('mobile:revoke-parent', parentId),
      matchStudents:     (data)                => invoke('mobile:match-students', data),
    },

    // ── Discounts ─────────────────────────────────────────
    discounts: {
      list:              (filters)             => invoke('discounts:list', filters || {}),
      getForStudent:     (studentId)           => invoke('discounts:get-for-student', studentId),
      save:              (data)                => invoke('discounts:save', data),
      revoke:            (data)                => invoke('discounts:revoke', data),
      compute:           (data)                => invoke('discounts:compute', data),
    },

    // ── Books ─────────────────────────────────────────────
    books: {
      list:              (filters)             => invoke('books:list', filters || {}),
      get:               (data)                => invoke('books:get', data),
      save:              (data)                => invoke('books:save', data),
      generateForClass:  (data)                => invoke('books:generate-for-class', data),
      recordPayment:     (data)                => invoke('books:record-payment', data),
      classPaymentSheet: (data)                => invoke('books:class-payment-sheet', data),
    },

    // ── Fees Bulk Pay ─────────────────────────────────────
    feesBulkPay: {
      sheet:             (data)                => invoke('fees:bulk-pay-sheet', data),
      record:            (data)                => invoke('fees:bulk-pay-record', data),
    },

    // ── Announcements (school → parents on the portal) ──
    announcements: {
      list:              ()                    => invoke('announcements:list'),
      save:              (data)                => invoke('announcements:save', data),
      delete:            (id)                  => invoke('announcements:delete', id),
    },

    // ── Timetable (bell schedule + per-class weekly grid) ──
    timetable: {
      listPeriods:       ()                    => invoke('timetable:list-periods'),
      seedDefaultPeriods:()                    => invoke('timetable:seed-default-periods'),
      savePeriod:        (data)                => invoke('timetable:save-period', data),
      deletePeriod:      (id)                  => invoke('timetable:delete-period', id),
      getClass:          (classId)             => invoke('timetable:get-class', { classId }),
      saveEntry:         (data)                => invoke('timetable:save-entry', data),
      deleteEntry:       (data)                => invoke('timetable:delete-entry', data),
      getTeacher:        (staffId)             => invoke('timetable:get-teacher', { staffId }),
      exportClassExcel:  (data)                => invoke('timetable:export-class-excel', data),
      exportClassPdf:    (data)                => invoke('timetable:export-class-pdf', data),
    },

    // ── Homework / assignments ──
    homework: {
      listClass:         (classId, all, termId) => invoke('homework:list-class', { classId, all: !!all, termId }),
      save:              (data)                => invoke('homework:save', data),
      delete:            (id)                  => invoke('homework:delete', id),
      sheet:             (homeworkId)          => invoke('homework:sheet', homeworkId),
      saveMarks:         (data)                => invoke('homework:save-marks', data),
      studentReport:     (studentId, termId)   => invoke('homework:student-report', { studentId, termId }),
    },

    // ── Messaging (parent ↔ school threads) ──
    messages: {
      listThreads:       ()                    => invoke('messages:list-threads'),
      getThread:         (threadId)            => invoke('messages:get-thread', threadId),
      reply:             (data)                => invoke('messages:reply', data),
      start:             (data)                => invoke('messages:start', data),
      markRead:          (data)                => invoke('messages:mark-read', data),
      staffUnread:       ()                    => invoke('messages:staff-unread'),
    },

    // ── Transport (bus routes, stops, riders, fee collection) ──
    transport: {
      listRoutes:        ()                    => invoke('transport:list-routes'),
      saveRoute:         (data)                => invoke('transport:save-route', data),
      deleteRoute:       (id)                  => invoke('transport:delete-route', id),
      listStops:         (routeId)             => invoke('transport:list-stops', routeId),
      saveStop:          (data)                => invoke('transport:save-stop', data),
      deleteStop:        (id)                  => invoke('transport:delete-stop', id),
      assign:            (data)                => invoke('transport:assign', data),
      unassign:          (studentId)           => invoke('transport:unassign', studentId),
      student:           (studentId, termId)   => invoke('transport:student', { studentId, termId }),
      listRiders:        (args)                => invoke('transport:list-riders', args || {}),
      recordPayment:     (data)                => invoke('transport:record-payment', data),
      dashboard:         (termId)              => invoke('transport:dashboard', termId),
    },

    // ── Cloud sync (thin-cloud, multi-school portal) ──
    cloud: {
      status:            ()                    => invoke('cloud:status'),
      configure:         (patch)               => invoke('cloud:configure', patch),
      pushNow:           ()                    => invoke('cloud:push-now'),
      pullNow:           ()                    => invoke('cloud:pull-now'),
      test:              ()                    => invoke('cloud:test'),
      backfill:          ()                    => invoke('cloud:backfill'),
      // What the school kept when a teacher's off-LAN work disagreed with it.
      conflicts:         (opts)                => invoke('cloud:conflicts', opts || {}),
      conflictReviewed:  (id)                  => invoke('cloud:conflict-reviewed', { id }),
      // Last term's report cards, so a parent can open one with the
      // school's computer switched off.
      publishReportCards: (termId)             => invoke('cloud:publish-report-cards', { termId }),
    },

    // ── Mobile payment intents (accounts office review) ──
    paymentIntents: {
      list:              (status)              => invoke('payments:list-intents', status),
      pendingCount:      ()                    => invoke('payments:pending-count'),
      acknowledge:       (data)                => invoke('payments:acknowledge-intent', data),
      reject:            (data)                => invoke('payments:reject-intent', data),
    },

    // ── Inventory ─────────────────────────────────────────
    inventory: {
      listItems:         (filters)             => invoke('inventory:list-items', filters || {}),
      getItem:           (id)                  => invoke('inventory:get-item', id),
      saveItem:          (data)                => invoke('inventory:save-item', data),
      recordMovement:    (data)                => invoke('inventory:record-movement', data),
      dashboard:         ()                    => invoke('inventory:dashboard'),
      categories:        ()                    => invoke('inventory:categories'),
    },

    // ── Audit Log ─────────────────────────────────────────
    audit: {
      log:               (data)                => invoke('audit:log', data),
      list:              (filters)             => invoke('audit:list', filters || {}),
    },

    // ── Receipt Templates ─────────────────────────────────
    receipts: {
      listTemplates:     (filters)             => invoke('receipts:list-templates', filters || {}),
      uploadTemplate:    (data)                => invoke('receipts:upload-template', data),
      setDefault:        (data)                => invoke('receipts:set-default', data),
      deleteTemplate:    (id)                  => invoke('receipts:delete-template', id),
      availableTags:     (templateType)        => invoke('receipts:available-tags', templateType),
      generate:          (data)                => invoke('receipts:generate', data),
      generateStandard:  (data)                => invoke('receipts:generate-standard', data),
      print:             (data)                => invoke('receipts:print', data),
      send:              (data)                => invoke('receipts:send', data),
      list:              (filters)             => invoke('receipts:list', filters || {}),
    },

    // ── Photos ────────────────────────────────────────────
    photos: {
      upload:            (data)                => invoke('photos:upload', data),
      remove:            (data)                => invoke('photos:remove', data),
      // A photo can be chosen before the record exists; these bind or bin it.
      attach:            (data)                => invoke('photos:attach', data),
      discard:           (data)                => invoke('photos:discard', data),
    },

    // ── Lesson Notes ─────────────────────────────────────
    lessonNotes: {
      list:              (filters)             => invoke('lesson-notes:list', filters),
      get:               (id)                  => invoke('lesson-notes:get', id),
      save:              (data)                => invoke('lesson-notes:save', data),
      delete:            (id)                  => invoke('lesson-notes:delete', id),
      review:            (data)                => invoke('lesson-notes:review', data),
    },

    // ── Staff Activities ─────────────────────────────────
    staffActivities: {
      list:              (filters)             => invoke('staff-activities:list', filters),
      save:              (data)                => invoke('staff-activities:save', data),
      delete:            (id)                  => invoke('staff-activities:delete', id),
      acknowledge:       (id)                  => invoke('staff-activities:acknowledge', id),
      summary:           (data)                => invoke('staff-activities:summary', data),
    },

    // ── Fees ─────────────────────────────────────────────
    fees: {
      listTemplates:     (filters)             => invoke('fees:list-templates', filters || {}),
      getTemplate:       (id)                  => invoke('fees:get-template', id),
      templatePresets:   ()                    => invoke('fees:template-presets'),
      copyableTemplates: (data)                => invoke('fees:copyable-templates', data || {}),
      copyTemplate:      (data)                => invoke('fees:copy-template', data),
      saveTemplate:      (data)                => invoke('fees:save-template', data),
      deleteTemplate:    (id)                  => invoke('fees:delete-template', id),
      generateBill:      (studentId, termId)   => invoke('fees:generate-bill', { studentId, termId }),
      generateBillsBulk: (scope)               => invoke('fees:generate-bulk', scope),
      listBills:         (filters)             => invoke('fees:list-bills', filters),
      getBill:           (id)                  => invoke('fees:get-bill', id),
      recordPayment:     (data)                => invoke('fees:record-payment', data),
      listPayments:      (studentId, termId)   => invoke('fees:list-payments', { studentId, termId }),
      debtorsReport:     (termId)              => invoke('fees:debtors-report', termId),
      dashboard:         (termId)              => invoke('fees:dashboard', termId),
      expectedIncome:    (termId)              => invoke('fees:expected-income', termId),
      studentFinProfile: (studentId)           => invoke('fees:student-financial-profile', studentId),

      // Billing administration — issuing extras and withdrawing bills.
      // Every mutating call here is re-checked against the caller's designation
      // on the Node side; the permissions probe only drives what the UI shows.
      // Raising the term's school fees, and the frameworks a bill starts from.
      frameworks:        (billType)            => invoke('fees:frameworks', billType),
      schoolFeesPlan:    (data)                => invoke('fees:school-fees-plan', data || {}),
      raiseSchoolFees:   (data)                => invoke('fees:raise-school-fees', data),
      billsSummary:      (termId)              => invoke('fees:bills-summary', termId),
      billingPermissions: ()                   => invoke('fees:billing-permissions'),
      billingOverview:   (termId)              => invoke('fees:billing-overview', termId),
      applySupplementary:(data)                => invoke('fees:apply-supplementary', data),
      removeSupplementary:(data)               => invoke('fees:remove-supplementary', data),
      voidBill:          (data)                => invoke('fees:void-bill', data),
      restoreBill:       (data)                => invoke('fees:restore-bill', data),
      deleteBill:        (data)                => invoke('fees:delete-bill', data),
      adjustBillItem:    (data)                => invoke('fees:adjust-bill-item', data),
      listVoidedBills:   (termId)              => invoke('fees:list-voided-bills', termId),
    },

    // ── Academics / Scores ────────────────────────────────
    scores: {
      listForClass:      (classId, termId)     => invoke('scores:list-for-class', { classId, termId }),
      saveBulk:          (payload)             => invoke('scores:save-bulk', payload),
      getStudentReport:  (studentId, termId)   => invoke('scores:student-report', { studentId, termId }),
      getStudentCumulative:(studentId)         => invoke('scores:student-cumulative', studentId),
      listSubjects:      ()                    => invoke('scores:list-subjects'),
      getWeights:        ()                    => invoke('scores:get-weights'),
      listAssessmentColumns: (data)            => invoke('scores:list-assessment-columns', data),
      addAssessmentColumn:   (data)            => invoke('scores:add-assessment-column', data),
      updateAssessmentColumn:(data)            => invoke('scores:update-assessment-column', data),
      deleteAssessmentColumn:(id)              => invoke('scores:delete-assessment-column', id),
      classSheet:        (data)                => invoke('scores:class-sheet', data),
      saveAssessmentMark:(data)                => invoke('scores:save-assessment-mark', data),
      examSheet:         (data)                => invoke('scores:exam-sheet', data),
      saveExamMark:      (data)                => invoke('scores:save-exam-mark', data),
      endOfTerm:         (data)                => invoke('scores:end-of-term', data),
      assessmentCompilationSheet:(data)        => invoke('scores:assessment-compilation-sheet', data),
      saveAssessmentCompilation:(data)         => invoke('scores:save-assessment-compilation', data),
      exportAssessmentCompilation:(data)       => invoke('scores:export-assessment-compilation', data),
      importAssessmentCompilation:(data)       => invoke('scores:import-assessment-compilation', data),
      rankClass:         (payload)             => invoke('scores:rank-class', payload),
      listComponents:    (classId, termId)     => invoke('scores:list-components', { classId, termId }),
      saveComponents:    (data)                => invoke('scores:save-components', data),
      saveTermSummary:   (data)                => invoke('scores:save-term-summary', data),
      getTermSummary:    (studentId, termId)   => invoke('scores:get-term-summary', { studentId, termId }),
    },

    // ── Academics dashboard ──────────────────────────────
    academics: {
      dashboard:         (termId)              => invoke('academics:dashboard', termId),
    },

    // ── Examinations ─────────────────────────────────────
    exams: {
      listPapers:        (filters)             => invoke('exams:list-papers', filters),
      getPaper:          (id)                  => invoke('exams:get-paper', id),
      savePaper:         (data)                => invoke('exams:save-paper', data),
      deletePaper:       (id)                  => invoke('exams:delete-paper', id),
      listSections:      (paperId)             => invoke('exams:list-sections', paperId),
      saveSection:       (data)                => invoke('exams:save-section', data),
      deleteSection:     (id)                  => invoke('exams:delete-section', id),
      listQuestions:     (filters)             => invoke('exams:list-questions', filters),
      saveQuestion:      (data)                => invoke('exams:save-question', data),
      deleteQuestion:    (id)                  => invoke('exams:delete-question', id),
      reorderQuestions:  (data)                => invoke('exams:reorder-questions', data),
      copyFromBank:      (data)                => invoke('exams:copy-from-bank', data),
      paperStats:        (paperId)             => invoke('exams:paper-stats', paperId),
      exportPaper:       (paperId, options)    => invoke('reports:generate-exam-paper', { paperId, options }),
      importFromTemplate:(filePath)            => invoke('exams:import-template', filePath),
    },

    // ── Canteen ───────────────────────────────────────────
    canteen: {
      getStudentProfile: (studentId, termId)   => invoke('canteen:student-profile', { studentId, termId }),
      recordPayment:     (data)                => invoke('canteen:record-payment', data),
      markDaysPaid:      (data)                => invoke('canteen:mark-days-paid', data),
      markBulkPaid:      (data)                => invoke('canteen:mark-bulk-paid', data),
      markExempt:        (data)                => invoke('canteen:mark-exempt', data),
      applyAttendanceExemption: (data)         => invoke('canteen:apply-attendance-exemption', data),
      classRosterForDate:(classId, date)       => invoke('canteen:class-roster-for-date', { classId, date }),
      classRosterForRange:(classId, dates)     => invoke('canteen:class-roster-for-range', { classId, dates }),
      setDayStatus:      (data)                => invoke('canteen:set-day-status', data),
      listCalendar:      (termId)              => invoke('canteen:list-calendar', termId),
      saveCalendarDay:   (data)                => invoke('canteen:save-calendar-day', data),
      setupTermCalendar: (data)                => invoke('canteen:setup-term-calendar', data),
      debtorsReport:     (termId)              => invoke('canteen:debtors-report', termId),
      dashboard:         (termId)              => invoke('canteen:dashboard', termId),
    },

    // ── Finance ───────────────────────────────────────────
    // ── Offline finance workbook (export / import) ───────
    // The school's continuity plan: one Excel file holding fees, canteen, books,
    // transport, other income, expenses and payroll, worked on while the system
    // is down and imported back when it returns.
    workbook: {
      status:        ()          => invoke('workbook:status'),
      exportBook:    (options)   => invoke('workbook:export', options || {}),
      openFolder:    ()          => invoke('workbook:open-folder'),
      reveal:        ()          => invoke('workbook:reveal'),
      pickFile:      ()          => invoke('workbook:pick-file'),
      previewImport: (data)      => invoke('workbook:preview-import', data),
      runImport:     (data)      => invoke('workbook:import', data),
      history:       (limit)     => invoke('workbook:import-history', limit || 200),
    },

    // ── Onboarding workbook (bringing a school across) ────
    // The same idea as the finance workbook, pointed the other way: one Excel
    // file holding the roll, the staff, the classes, the subjects, the fee
    // schedule and what each pupil owes, so a school moves onto the system in
    // an afternoon instead of a term of typing.
    onboarding: {
      status:      ()        => invoke('onboarding:status'),
      exportBook:  (options) => invoke('onboarding:export', options || {}),
      openFolder:  ()        => invoke('onboarding:open-folder'),
      pickFile:    ()        => invoke('onboarding:pick-file'),
      preview:     (data)    => invoke('onboarding:preview', data),
      runImport:   (data)    => invoke('onboarding:import', data),
    },

    finance: {
      dashboard:         (termId)              => invoke('finance:dashboard', termId),
      listIncome:        (filters)             => invoke('finance:list-income', filters),
      recordIncome:      (data)                => invoke('finance:record-income', data),
      updateIncome:      (id, data)            => invoke('finance:update-income', { id, data }),
      deleteIncome:      (data)                => invoke('finance:delete-income', data),
      listExpense:       (filters)             => invoke('finance:list-expense', filters),
      recordExpense:     (data)                => invoke('finance:record-expense', data),
      updateExpense:     (id, data)            => invoke('finance:update-expense', { id, data }),
      deleteExpense:     (data)                => invoke('finance:delete-expense', data),
      summary:           (termId)              => invoke('finance:summary', termId),
      financialStatement:(params)              => invoke('finance:financial-statement', params),
      expectedIncome:    (termId)              => invoke('finance:expected-income', termId),
      listBudgets:       (filters)             => invoke('finance:list-budgets', filters),
      getBudget:         (id)                  => invoke('finance:get-budget', id),
      saveBudget:        (data)                => invoke('finance:save-budget', data),
      deleteBudget:      (id)                  => invoke('finance:delete-budget', id),
      saveBudgetItem:    (data)                => invoke('finance:save-budget-item', data),
      deleteBudgetItem:  (id)                  => invoke('finance:delete-budget-item', id),
    },

    // ── Reports / Printing ────────────────────────────────
    reports: {
      generateReportCards: (params)            => invoke('reports:generate-report-cards', params),
      renderCardHtml:      (data)              => invoke('reports:render-card-html', data),
      generateBillsPdf:    (params)            => invoke('reports:generate-bills-pdf', params),
      generatePayslip:     (salaryId, opts)    => invoke('reports:generate-payslip', { salaryId, options: opts }),
      generateReceipt:     (paymentId, opts)   => invoke('reports:generate-receipt', { paymentId, options: opts }),
      generateStudentProfile: (studentId, opts) => invoke('reports:generate-student-profile', { studentId, options: opts }),
      generateAttestation: (studentId, kind, opts) => invoke('reports:generate-attestation', { studentId, kind, options: opts }),
      generateCanteenBills: (params)           => invoke('reports:generate-canteen-bills', params),
      generateBooksBills:  (params)            => invoke('reports:generate-books-bills', params),
      generateDebtorsList: (termId, opts)      => invoke('reports:debtors-list', { termId, options: opts }),
      generateClassList:   (classId, opts)     => invoke('reports:class-list', { classId, options: opts }),
      printToPdf:          (html, opts)        => invoke('reports:print-to-pdf', { html, options: opts }),
    },

    // ── The payment desk ──────────────────────────────────
    // One counter, every purpose. Dispatches to each module's own recorder.
    payments: {
      purposes:       ()      => invoke('payments:purposes'),
      findStudents:   (f)     => invoke('payments:find-students', f || {}),
      studentAccount: (d)     => invoke('payments:student-account', d),
      take:           (d)     => invoke('payments:take', d),
      receipt:        (d)     => invoke('payments:receipt', d),
      register:       (f)     => invoke('payments:register', f || {}),
    },

    // ── Settings ──────────────────────────────────────────
    settings: {
      getAll:            ()                    => invoke('settings:get-all'),
      set:               (key, value)          => invoke('settings:set', { key, value }),
      uploadLogo:        (src)                 => invoke('settings:upload-logo', src),
      uploadSignature:   (data)                => invoke('settings:upload-signature', data),
      removeSignature:   (role)                => invoke('settings:remove-signature', role),
      getSignatureForUse:(data)                => invoke('settings:get-signature-for-use', data),
      listClasses:       ()                    => invoke('settings:list-classes'),
      saveClass:         (data)                => invoke('settings:save-class', data),
      deleteClass:       (id)                  => invoke('settings:delete-class', id),
      listTerms:         ()                    => invoke('settings:list-terms'),
      saveTerm:          (data)                => invoke('settings:save-term', data),
      setCurrentTerm:    (id)                  => invoke('settings:set-current-term', id),
      listAcademicYears: ()                    => invoke('settings:list-academic-years'),
      saveAcademicYear:  (data)                => invoke('settings:save-academic-year', data),
      listGradingBands:  ()                    => invoke('settings:list-grading-bands'),
      saveGradingBands:  (bands)               => invoke('settings:save-grading-bands', bands),
      listSubjects:      ()                    => invoke('settings:list-subjects'),
      saveSubject:       (data)                => invoke('settings:save-subject', data),
      deleteSubject:     (id)                  => invoke('settings:delete-subject', id),
      getClassSubjects:  (classId)             => invoke('settings:get-class-subjects', classId),
      setClassSubjects:  (classId, ids)        => invoke('settings:set-class-subjects', { classId, subjectIds: ids }),
    },

    // ── Academic Session / Term automation ────────────────
    session: {
      status:            ()                    => invoke('session:status'),
      setMode:           (data)                => invoke('session:set-mode', data),
      migrationPreview:  (targetTermId)        => invoke('session:migration-preview', { targetTermId }),
      migrateTerm:       (data)                => invoke('session:migrate-term', data),
    },

    // ── Notifications ─────────────────────────────────────
    notifications: {
      send:              (data)                => invoke('notifications:send', data),
      sendBulk:          (data)                => invoke('notifications:send-bulk', data),
      listLog:           (filters)             => invoke('notifications:list-log', filters),
      getTemplates:      ()                    => invoke('notifications:get-templates'),
      saveTemplate:      (data)                => invoke('notifications:save-template', data),
    },

    // ── Backup / Restore / Factory Reset ──────────────────
    backup: {
      getInfo:           ()                    => invoke('backup:get-info'),
      list:              ()                    => invoke('backup:list'),
      create:            ()                    => invoke('backup:create'),
      restore:           (backupPath)          => invoke('backup:restore', backupPath),
      factoryReset:      (data)                => invoke('backup:factory-reset', data),
      openFolder:        ()                    => invoke('backup:open-folder'),
      getConfig:         ()                    => invoke('backup:get-config'),
      setConfig:         (patch)               => invoke('backup:set-config', patch),
      runAuto:           ()                    => invoke('backup:run-auto'),
      pickFolder:        ()                    => invoke('backup:pick-folder'),
      // Advanced: health status, destinations, retry, save-a-copy, restore-from-file.
      status:            ()                    => invoke('backup:status'),
      listDestinations:  ()                    => invoke('backup:list-destinations'),
      addDestination:    (data)                => invoke('backup:add-destination', data),
      updateDestination: (data)                => invoke('backup:update-destination', data),
      removeDestination: (id)                  => invoke('backup:remove-destination', id),
      testDestination:   (data)                => invoke('backup:test-destination', data),
      retry:             ()                    => invoke('backup:retry'),
      saveCopy:          (backupPath)          => invoke('backup:save-copy', backupPath),
      pickFile:          ()                    => invoke('backup:pick-file'),
      setPrimaryFolder:  (folder)              => invoke('backup:set-primary-folder', folder),
    },

    // ── App-level ─────────────────────────────────────────
    app: {
      getPaths:          ()                    => invoke('app:get-paths'),
      showOpenDialog:    (opts)                => invoke('app:show-open-dialog', opts),
      showSaveDialog:    (opts)                => invoke('app:show-save-dialog', opts),
      openFolder:        (fp)                  => invoke('app:open-folder', fp),
      openFile:          (fp)                  => invoke('app:open-file', fp),
      openPdfPreview:    (fp)                  => invoke('app:open-pdf-preview', fp),
      printToPdf:        (opts)                => invoke('app:print-to-pdf', opts),
      diagnostics:       ()                    => invoke('app:diagnostics'),
      openLogs:          ()                    => invoke('app:open-logs'),
    },
  };

  return api;
}

module.exports = { buildApi };
