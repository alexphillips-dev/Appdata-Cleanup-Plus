(function(window, document, $) {
  "use strict";

  var ACP = window.AppdataCleanupPlus = window.AppdataCleanupPlus || {};
  var config = window.appdataCleanupPlusConfig || {};
  var strings = config.strings || {};
  var state = {
    rows: [],
    summary: { total: 0, deletable: 0, review: 0, blocked: 0, ignored: 0 },
    selected: {},
    scanToken: "",
    dockerRunning: true,
    latestAuditMessage: "",
    auditHistory: [],
    auditOpen: false,
    settings: ACP.defaultSafetySettings(),
    quarantine: {
      open: false,
      loading: false,
      loaded: false,
      entries: [],
      summary: { count: 0, sizeLabel: "0 B" }
    },
    riskFilter: "all",
    sortMode: "risk",
    showIgnored: false,
    busy: false
  };
  var els = {};

  $(init);

  function init() {
    cacheElements();
    ACP.applyThemeState(els.$app);
    ACP.watchThemeChanges(function() {
      ACP.applyThemeState(els.$app);
      ACP.syncDeleteModalThemeTokens($(".sweet-alert"));
    });
    bindEvents();
    renderSummaryCards();
    renderResultsMeta();
    renderPanels();
    renderLoadingState();
    updateActionBar();
    loadScan();
  }

  function cacheElements() {
    els.$app = $("#acp-app");
    els.$summaryCards = $("#acp-summary-cards");
    els.$search = $("#acp-search");
    els.$riskFilter = $("#acp-risk-filter");
    els.$showIgnored = $("#acp-show-ignored");
    els.$allowExternal = $("#acp-allow-external");
    els.$enableDelete = $("#acp-enable-delete");
    els.$sort = $("#acp-sort");
    els.$rescan = $("#acp-rescan");
    els.$selectVisible = $("#acp-select-visible");
    els.$clearSelection = $("#acp-clear-selection");
    els.$doneBottom = $("#acp-done-bottom");
    els.$dryRun = $("#acp-dry-run");
    els.$primaryAction = $("#acp-primary-action");
    els.$resultsMeta = $("#acp-results-meta");
    els.$modeStrip = $("#acp-mode-strip");
    els.$notices = $("#acp-notices");
    els.$auditPanel = $("#acp-audit-panel");
    els.$quarantinePanel = $("#acp-quarantine-panel");
    els.$results = $("#acp-results");
    els.$selectionSummary = $("#acp-selection-summary");
    els.$selectionDetail = $("#acp-selection-detail");
  }

  function bindEvents() {
    els.$search.on("input", renderAll);

    els.$riskFilter.on("change", function() {
      state.riskFilter = els.$riskFilter.val();
      renderResults();
      renderResultsMeta();
      updateActionBar();
    });

    els.$showIgnored.on("change", function() {
      state.showIgnored = !!els.$showIgnored.prop("checked");
      renderResults();
      renderResultsMeta();
      updateActionBar();
    });

    els.$sort.on("change", function() {
      state.sortMode = els.$sort.val();
      renderResults();
      renderResultsMeta();
    });

    els.$rescan.on("click", function() {
      if (!state.busy) {
        loadScan();
      }
    });

    els.$selectVisible.on("click", function() {
      if (!state.busy) {
        selectVisibleRows();
      }
    });

    els.$clearSelection.on("click", function() {
      if (state.busy) {
        return;
      }

      state.selected = {};
      renderResults();
      renderSummaryCards();
      updateActionBar();
    });

    els.$doneBottom.on("click", closePage);
    els.$dryRun.on("click", startDryRunFlow);
    els.$primaryAction.on("click", startPrimaryActionFlow);

    els.$allowExternal.on("change", saveSafetySettings);
    els.$enableDelete.on("change", saveSafetySettings);

    els.$results.on("click", ".acp-row", function(event) {
      if ($(event.target).closest(".acp-row-checkbox, .acp-button, a, button, input, select, textarea").length) {
        return;
      }

      var $checkbox = $(this).find(".acp-row-checkbox:not(:disabled)").first();
      if (!$checkbox.length) {
        return;
      }

      $checkbox.prop("checked", !$checkbox.prop("checked")).trigger("change");
    });

    els.$results.on("change", ".acp-row-checkbox", function() {
      var rowId = $(this).data("row-id");

      if (!rowId) {
        return;
      }

      if (this.checked) {
        state.selected[rowId] = true;
      } else {
        delete state.selected[rowId];
      }

      renderResults();
      renderSummaryCards();
      updateActionBar();
    });

    els.$results.on("click", ".acp-row-action", function(event) {
      var action = $(this).data("row-action");
      var rowId = $(this).data("row-id");

      event.preventDefault();
      event.stopPropagation();

      if (!action || !rowId || state.busy) {
        return;
      }

      postRowAction(action, rowId);
    });

    els.$results.on("click", "[data-action]", function() {
      var action = $(this).data("action");

      if (action === "clear-filters") {
        clearFilters();
      }

      if (action === "rescan") {
        loadScan();
      }
    });

    els.$modeStrip.on("click", "[data-action='toggle-quarantine']", function() {
      if (!state.busy) {
        toggleQuarantinePanel();
      }
    });

    els.$auditPanel.on("click", "[data-action='toggle-audit']", function() {
      if (!state.busy) {
        state.auditOpen = !state.auditOpen;
        renderPanels();
      }
    });

    els.$quarantinePanel.on("click", "[data-action='toggle-quarantine']", function() {
      if (!state.busy) {
        toggleQuarantinePanel();
      }
    });

    els.$quarantinePanel.on("click", "[data-action='refresh-quarantine']", function() {
      if (!state.busy) {
        loadQuarantineManager(true);
      }
    });

    els.$quarantinePanel.on("click", "[data-entry-action]", function(event) {
      var action = $(this).data("entry-action");
      var entryId = $(this).data("entry-id");

      event.preventDefault();
      event.stopPropagation();

      if (!action || !entryId || state.busy) {
        return;
      }

      startQuarantineManagerActionFlow(action, entryId);
    });
  }

  function buildContext() {
    return {
      state: state,
      els: els,
      strings: strings
    };
  }

  function closePage() {
    if (typeof window.done === "function") {
      window.done();
    }
  }

  function apiPost(data) {
    var requestHeaders = {};

    if (config.csrfToken) {
      requestHeaders["X-Appdata-Cleanup-Plus-CSRF"] = String(config.csrfToken);
    }

    return $.ajax({
      url: config.apiUrl,
      method: "POST",
      dataType: "json",
      headers: requestHeaders,
      data: ACP.buildApiRequestData(config, data)
    });
  }

  function syncSafetyControls() {
    var settings = $.extend({}, ACP.defaultSafetySettings(), state.settings || {});

    els.$allowExternal.prop("checked", !!settings.allowOutsideShareCleanup);
    els.$enableDelete.prop("checked", !!settings.enablePermanentDelete);
  }

  function getPrimaryOperation() {
    return state.settings.enablePermanentDelete ? "delete" : "quarantine";
  }

  function getPrimaryActionLabel() {
    return state.settings.enablePermanentDelete
      ? ACP.t(strings, "deleteActionLabel", "Delete selected")
      : ACP.t(strings, "quarantineActionLabel", "Quarantine selected");
  }

  function setBusy(isBusy) {
    state.busy = !!isBusy;
    els.$app.toggleClass("is-busy", state.busy);
    els.$rescan.prop("disabled", state.busy);
    els.$search.prop("disabled", state.busy);
    els.$riskFilter.prop("disabled", state.busy);
    els.$showIgnored.prop("disabled", state.busy);
    els.$allowExternal.prop("disabled", state.busy);
    els.$enableDelete.prop("disabled", state.busy);
    els.$sort.prop("disabled", state.busy);
    updateActionBar();
  }

  function resetDashboardState() {
    state.rows = [];
    state.summary = { total: 0, deletable: 0, review: 0, blocked: 0, ignored: 0 };
    state.selected = {};
    state.scanToken = "";
    state.dockerRunning = true;
    state.latestAuditMessage = "";
    state.auditHistory = [];
    state.settings = ACP.defaultSafetySettings();
    state.quarantine.summary = { count: 0, sizeLabel: "0 B" };
  }

  function loadScan() {
    setBusy(true);
    renderLoadingState();

    apiPost({
      action: "getOrphanAppdata"
    }).done(function(response) {
      state.rows = $.isArray(response.rows) ? response.rows : [];
      state.summary = response.summary || { total: 0, deletable: 0, review: 0, blocked: 0, ignored: 0 };
      state.scanToken = String(response.scanToken || "");
      state.dockerRunning = response.dockerRunning !== false;
      state.latestAuditMessage = String(response.latestAuditMessage || "");
      state.auditHistory = $.isArray(response.auditHistory) ? response.auditHistory : [];
      state.settings = $.extend({}, ACP.defaultSafetySettings(), response.settings || {});
      state.quarantine.summary = $.extend({ count: 0, sizeLabel: "0 B" }, response.quarantineSummary || {});
      syncSafetyControls();
      applyLocalSafetyState();
      reconcileSelection();
      renderAll();
    }).fail(function(xhr) {
      resetDashboardState();
      syncSafetyControls();
      renderSummaryCards();
      renderPanels();
      renderNotices([]);
      renderResultsMeta();
      renderStateMessage(
        ACP.t(strings, "scanFailedTitle", "Scan failed"),
        ACP.extractErrorMessage(xhr, ACP.t(strings, "scanFailedMessage", "The orphaned appdata scan could not be completed right now.")),
        "rescan",
        ACP.t(strings, "rescanLabel", "Rescan")
      );
      updateActionBar();
    }).always(function() {
      setBusy(false);
    });
  }

  function loadQuarantineManager(forceRefresh) {
    if (state.quarantine.loading) {
      return;
    }

    state.quarantine.loading = true;
    if (forceRefresh) {
      state.quarantine.loaded = false;
    }
    renderPanels();

    apiPost({
      action: "getQuarantineEntries"
    }).done(function(response) {
      var quarantine = response.quarantine || {};
      state.quarantine.entries = $.isArray(quarantine.entries) ? quarantine.entries : [];
      state.quarantine.summary = $.extend({ count: 0, sizeLabel: "0 B" }, quarantine.summary || {});
      state.quarantine.loaded = true;
      state.quarantine.loading = false;
      renderPanels();
    }).fail(function(xhr) {
      state.quarantine.loading = false;
      swal(
        ACP.t(strings, "quarantineFailedTitle", "Quarantine failed"),
        ACP.extractErrorMessage(xhr, ACP.t(strings, "quarantineLoadFailedMessage", "The quarantine manager could not be loaded right now.")),
        "error"
      );
      renderPanels();
    });
  }

  function toggleQuarantinePanel() {
    state.quarantine.open = !state.quarantine.open;
    renderPanels();

    if (state.quarantine.open && !state.quarantine.loaded) {
      loadQuarantineManager(true);
    }
  }

  function applyLocalSafetyStateToRow(row) {
    var nextRow = $.extend({}, row);

    nextRow.policyLocked = false;
    nextRow.policyReason = "";

    if (nextRow.ignored) {
      nextRow.canDelete = false;
      return nextRow;
    }

    if (nextRow.securityLockReason) {
      nextRow.canDelete = false;
      nextRow.policyLocked = true;
      nextRow.policyReason = nextRow.securityLockReason;
      return nextRow;
    }

    if (nextRow.risk === "blocked") {
      nextRow.canDelete = false;
      return nextRow;
    }

    if (nextRow.risk === "review" && !state.settings.allowOutsideShareCleanup) {
      nextRow.canDelete = false;
      nextRow.policyLocked = true;
      nextRow.policyReason = "Outside-share cleanup is disabled in Safety settings.";
      return nextRow;
    }

    nextRow.canDelete = true;
    return nextRow;
  }

  function buildLocalSummary(rows) {
    var summary = { total: 0, safe: 0, review: 0, blocked: 0, deletable: 0, ignored: 0 };

    $.each(rows || [], function(_, row) {
      if (row.ignored) {
        summary.ignored += 1;
        return;
      }

      summary.total += 1;

      if (Object.prototype.hasOwnProperty.call(summary, row.risk)) {
        summary[row.risk] += 1;
      }

      if (row.canDelete) {
        summary.deletable += 1;
      }
    });

    return summary;
  }

  function buildLocalNotices() {
    var notices = [];
    var summary = state.summary || { total: 0, review: 0, blocked: 0, ignored: 0 };

    if (!state.dockerRunning) {
      notices.push({
        type: "warning",
        title: ACP.t(strings, "noticeDockerOfflineTitle", "Docker is offline"),
        message: ACP.t(strings, "noticeDockerOfflineMessage", "Results are based only on saved Docker templates. Review every path before acting on anything.")
      });
    }

    if (Number(summary.ignored || 0) > 0) {
      notices.push({
        type: "info",
        title: ACP.t(strings, "noticeIgnoredTitle", "Ignore list active"),
        message: Number(summary.ignored || 0) + " " + (Number(summary.ignored || 0) === 1 ? "path is" : "paths are") + " currently hidden from normal cleanup results. Turn on Show ignored to review or restore them."
      });
    }

    if (state.latestAuditMessage) {
      notices.push({
        type: "info",
        title: ACP.t(strings, "noticeLatestAuditTitle", "Last cleanup"),
        message: state.latestAuditMessage
      });
    }

    if (Number(summary.review || 0) > 0) {
      if (!state.settings.allowOutsideShareCleanup) {
        notices.push({
          type: "info",
          title: ACP.t(strings, "noticeOutsideShareDisabledTitle", "Outside-share cleanup is disabled"),
          message: ACP.t(strings, "noticeOutsideShareDisabledMessage", "Review paths stay visible but locked until you explicitly enable outside-share cleanup.")
        });
      } else {
        notices.push({
          type: "warning",
          title: ACP.t(strings, "noticeOutsideShareEnabledTitle", "Outside-share cleanup is enabled"),
          message: ACP.t(strings, "noticeOutsideShareEnabledMessage", "Review paths sit outside the configured appdata share. Confirm each one carefully before acting.")
        });
      }
    }

    if (Number(summary.blocked || 0) > 0) {
      notices.push({
        type: "warning",
        title: ACP.t(strings, "noticeLockedPathsTitle", "Locked paths stay blocked"),
        message: ACP.t(strings, "noticeLockedPathsMessage", "Any path that resolves to a share root, mount point, symlinked location, or other unsafe target cannot be acted on here.")
      });
    }

    return notices;
  }

  function applyLocalSafetyState() {
    state.rows = $.map(state.rows || [], function(row) {
      return applyLocalSafetyStateToRow(row);
    });
    state.summary = buildLocalSummary(state.rows);
  }

  function reconcileSelection() {
    var allowed = {};

    $.each(state.rows, function(_, row) {
      if (row.canDelete) {
        allowed[row.id] = true;
      }
    });

    $.each(Object.keys(state.selected), function(_, rowId) {
      if (!allowed[rowId]) {
        delete state.selected[rowId];
      }
    });
  }

  function renderPanels() {
    ACP.renderModeStrip(buildContext());
    ACP.renderAuditPanel(buildContext());
    ACP.renderQuarantinePanel(buildContext());
  }

  function renderAll() {
    renderSummaryCards();
    renderPanels();
    renderNotices(buildLocalNotices());
    renderResults();
    renderResultsMeta();
    updateActionBar();
  }

  function renderSummaryCards() {
    var selectedCount = getSelectedRows().length;
    var cards = [
      { label: ACP.t(strings, "cardTotal", "Detected"), value: state.summary.total || 0, tone: "" },
      { label: ACP.t(strings, "cardDeletable", "Ready"), value: state.summary.deletable || 0, tone: "is-accent" },
      { label: ACP.t(strings, "cardReview", "Needs review"), value: state.summary.review || 0, tone: "is-review" },
      { label: ACP.t(strings, "cardBlocked", "Locked"), value: state.summary.blocked || 0, tone: "is-blocked" },
      { label: ACP.t(strings, "cardSelected", "Selected"), value: selectedCount, tone: "is-safe" }
    ];
    var html = [];

    $.each(cards, function(_, card) {
      html.push(
        '<article class="acp-summary-card ' + card.tone + '">' +
          '<span class="acp-summary-label">' + ACP.escapeHtml(card.label) + "</span>" +
          '<span class="acp-summary-value">' + ACP.escapeHtml(String(card.value)) + "</span>" +
        "</article>"
      );
    });

    els.$summaryCards.html(html.join(""));
  }

  function renderNotices(notices) {
    var html = [];

    $.each(notices || [], function(_, notice) {
      html.push(
        '<article class="acp-notice is-' + ACP.escapeHtml(notice.type || "info") + '">' +
          '<div class="acp-notice-title">' + ACP.escapeHtml(notice.title || "") + "</div>" +
          '<div class="acp-notice-message">' + ACP.escapeHtml(notice.message || "") + "</div>" +
        "</article>"
      );
    });

    els.$notices.html(html.join(""));
  }

  function renderLoadingState() {
    renderPanels();
    renderNotices([]);
    renderResultsMeta("");
    renderStateMessage(
      ACP.t(strings, "loadingTitle", "Scanning saved Docker templates"),
      ACP.t(strings, "loadingMessage", "Reviewing orphaned appdata folders and active container mappings."),
      null,
      null,
      true
    );
  }

  function buildRowMetaHtml(row) {
    var facts = [];
    var sourceText = row.sourceCount > 0 ? row.sourceSummary : row.name;

    facts.push('<span class="acp-row-meta-item"><strong>' + ACP.escapeHtml(ACP.t(strings, "templateLabel", "Template")) + "</strong> " + ACP.escapeHtml(sourceText || "") + "</span>");

    if (row.targetSummary) {
      facts.push('<span class="acp-row-meta-item"><strong>' + ACP.escapeHtml(ACP.t(strings, "targetLabel", "Target")) + "</strong> " + ACP.escapeHtml(row.targetSummary) + "</span>");
    }

    facts.push('<span class="acp-row-meta-item"><strong>' + ACP.escapeHtml(ACP.t(strings, "sizeLabel", "Size")) + "</strong> " + ACP.escapeHtml(row.sizeLabel || "Unknown") + "</span>");
    facts.push(
      '<span class="acp-row-meta-item"' + (row.lastModifiedExact ? ' title="' + ACP.escapeHtml(row.lastModifiedExact) + '"' : "") + '><strong>' +
      ACP.escapeHtml(ACP.t(strings, "updatedLabel", "Updated")) +
      "</strong> " + ACP.escapeHtml(row.lastModifiedLabel || "Unknown") + "</span>"
    );

    return facts.join('<span class="acp-row-meta-separator">|</span>');
  }

  function buildRowNotesHtml(row) {
    var notes = [];

    if (row.reason) {
      notes.push('<div class="acp-row-note is-primary">' + ACP.escapeHtml(row.reason) + "</div>");
    }

    if (row.policyReason) {
      notes.push('<div class="acp-row-note is-warning">' + ACP.escapeHtml(row.policyReason) + "</div>");
    }

    if (row.ignored && row.ignoredReason) {
      notes.push('<div class="acp-row-note">' + ACP.escapeHtml(row.ignoredReason) + "</div>");
    } else if (!row.policyReason && row.risk !== "safe" && row.riskReason) {
      notes.push('<div class="acp-row-note">' + ACP.escapeHtml(row.riskReason) + "</div>");
    }

    return notes.join("");
  }

  function buildRowActionHtml(row) {
    if (row.ignored) {
      return '<button type="button" class="acp-button acp-button-secondary acp-row-action" data-row-action="unignore" data-row-id="' + ACP.escapeHtml(row.id || "") + '">' + ACP.escapeHtml(ACP.t(strings, "restoreActionLabel", "Restore")) + "</button>";
    }

    if (row.id) {
      return '<button type="button" class="acp-button acp-button-secondary acp-row-action" data-row-action="ignore" data-row-id="' + ACP.escapeHtml(row.id || "") + '">' + ACP.escapeHtml(ACP.t(strings, "ignoreActionLabel", "Ignore")) + "</button>";
    }

    return "";
  }

  function renderResults() {
    var visibleRows = getVisibleRows();
    var html = [];

    if (!state.rows.length) {
      renderStateMessage(
        ACP.t(strings, "emptyTitle", "No orphaned appdata found"),
        ACP.t(strings, "emptyMessage", "Nothing currently looks safe to clean up from the saved Docker templates."),
        "rescan",
        ACP.t(strings, "rescanLabel", "Rescan")
      );
      return;
    }

    if (!visibleRows.length) {
      if (!state.showIgnored && Number(state.summary.total || 0) === 0 && Number(state.summary.ignored || 0) > 0) {
        renderStateMessage(
          ACP.t(strings, "ignoredOnlyTitle", "Only ignored paths remain"),
          ACP.t(strings, "ignoredOnlyMessage", "Every detected candidate is hidden by your ignore list. Turn on Show ignored to review or restore hidden paths."),
          null,
          null
        );
        return;
      }

      renderStateMessage(
        ACP.t(strings, "noMatchesTitle", "No folders match the current filters"),
        ACP.t(strings, "noMatchesMessage", "Clear the search or risk filters to see the full scan again."),
        "clear-filters",
        ACP.t(strings, "clearFiltersLabel", "Clear filters")
      );
      return;
    }

    $.each(visibleRows, function(_, row) {
      var isSelected = !!state.selected[row.id];
      var riskClass = "acp-badge-risk-" + ACP.escapeHtml(row.risk || "safe");
      var rowClass = "acp-row";
      var rowActionHtml = buildRowActionHtml(row);

      if (isSelected) {
        rowClass += " is-selected";
      }
      if (row.ignored) {
        rowClass += " is-ignored";
      }
      if (!row.canDelete) {
        rowClass += " is-disabled";
      } else {
        rowClass += " is-clickable";
      }

      html.push(
        '<article class="' + rowClass + '" data-row-id="' + ACP.escapeHtml(row.id) + '">' +
          '<div class="acp-row-check">' +
            '<input type="checkbox" class="acp-row-checkbox" data-row-id="' + ACP.escapeHtml(row.id) + '"' + (isSelected ? " checked" : "") + (row.canDelete ? "" : " disabled") + ">" +
          "</div>" +
          '<div class="acp-row-main">' +
            '<div class="acp-row-primary">' +
              '<div class="acp-row-title-wrap">' +
                '<div class="acp-row-title-line">' +
                  '<h3 class="acp-row-title">' + ACP.escapeHtml(row.name || row.displayPath || "") + "</h3>" +
                  '<div class="acp-row-badges">' +
                    '<span class="acp-badge acp-badge-status">' + ACP.escapeHtml(row.statusLabel || "") + "</span>" +
                    '<span class="acp-badge ' + riskClass + '">' + ACP.escapeHtml(row.riskLabel || "") + "</span>" +
                  "</div>" +
                "</div>" +
                '<div class="acp-row-meta">' + buildRowMetaHtml(row) + "</div>" +
              "</div>" +
              '<div class="acp-row-side">' +
                '<code class="acp-row-path">' + ACP.escapeHtml(row.displayPath || "") + "</code>" +
                rowActionHtml +
              "</div>" +
            "</div>" +
            '<div class="acp-row-notes">' + buildRowNotesHtml(row) + "</div>" +
          "</div>" +
        "</article>"
      );
    });

    els.$results.html(html.join(""));
  }

  function renderResultsMeta() {
    var visibleRows = getVisibleRows();
    var hiddenIgnored = Number(state.summary.ignored || 0) > 0 && !state.showIgnored;
    var parts = [
      visibleRows.length + " " + ACP.t(strings, "visibleSummary", "visible"),
      Number(state.summary.total || 0) + " " + ACP.t(strings, "detectedSummary", "detected")
    ];

    if (hiddenIgnored) {
      parts.push(Number(state.summary.ignored || 0) + " " + ACP.t(strings, "ignoredHiddenSummary", "ignored hidden"));
    } else if (state.showIgnored && Number(state.summary.ignored || 0) > 0) {
      parts.push(Number(state.summary.ignored || 0) + " " + ACP.t(strings, "ignoredShownSummary", "ignored shown"));
    }

    els.$resultsMeta.text(parts.join(" | "));
  }

  function renderStateMessage(title, message, action, actionLabel, isLoading) {
    var buttonHtml = action ? '<div class="acp-state-actions"><button type="button" class="acp-button acp-button-secondary" data-action="' + ACP.escapeHtml(action) + '">' + ACP.escapeHtml(actionLabel || "") + "</button></div>" : "";
    var iconHtml = isLoading ? '<div class="acp-state-icon"><img src="' + ACP.escapeHtml(config.spinnerUrl || "") + '" alt=""></div>' : "";

    els.$results.html(
      '<section class="acp-state">' +
        iconHtml +
        '<h3 class="acp-state-title">' + ACP.escapeHtml(title || "") + "</h3>" +
        '<p class="acp-state-message">' + ACP.escapeHtml(message || "") + "</p>" +
        buttonHtml +
      "</section>"
    );
  }

  function getVisibleRows() {
    var term = $.trim(String(els.$search.val() || "")).toLowerCase();

    return $.grep(state.rows || [], function(row) {
      var haystack = ((row.name || "") + " " + (row.displayPath || "") + " " + (row.sourceSummary || "") + " " + (row.targetSummary || "")).toLowerCase();

      if (!state.showIgnored && row.ignored) {
        return false;
      }

      if (state.riskFilter !== "all" && row.risk !== state.riskFilter) {
        return false;
      }

      if (term && haystack.indexOf(term) === -1) {
        return false;
      }

      return true;
    }).sort(compareRows);
  }

  function compareRows(left, right) {
    var riskRank = { review: 0, safe: 1, blocked: 2 };
    var leftName = String(left.name || "").toLowerCase();
    var rightName = String(right.name || "").toLowerCase();
    var leftPath = String(left.displayPath || left.path || "").toLowerCase();
    var rightPath = String(right.displayPath || right.path || "").toLowerCase();
    var leftRank = Object.prototype.hasOwnProperty.call(riskRank, left.risk) ? riskRank[left.risk] : 9;
    var rightRank = Object.prototype.hasOwnProperty.call(riskRank, right.risk) ? riskRank[right.risk] : 9;

    if (!!left.ignored !== !!right.ignored) {
      return left.ignored ? 1 : -1;
    }

    if (state.sortMode === "name") {
      return leftName.localeCompare(rightName) || leftPath.localeCompare(rightPath);
    }

    if (state.sortMode === "path") {
      return leftPath.localeCompare(rightPath) || leftName.localeCompare(rightName);
    }

    return leftRank - rightRank || leftPath.localeCompare(rightPath);
  }

  function selectVisibleRows() {
    $.each(getVisibleRows(), function(_, row) {
      if (row.canDelete) {
        state.selected[row.id] = true;
      }
    });

    renderResults();
    renderSummaryCards();
    updateActionBar();
  }

  function updateActionBar() {
    var selectedRows = getSelectedRows();
    var visibleSelectableCount = $.grep(getVisibleRows(), function(row) {
      return !!row.canDelete;
    }).length;
    var reviewSelected = $.grep(selectedRows, function(row) {
      return row.risk === "review";
    }).length;
    var summaryText = selectedRows.length + " " + (selectedRows.length === 1 ? ACP.t(strings, "selectedSingular", "folder selected") : ACP.t(strings, "selectedPlural", "folders selected"));
    var detailText = ACP.t(strings, "selectionHintIdle", "Click rows to select. Locked paths stay visible but cannot be selected.");

    if (!state.settings.allowOutsideShareCleanup && Number(state.summary.review || 0) > 0) {
      detailText = ACP.t(strings, "selectionHintSafety", "Outside-share cleanup is disabled, so review rows stay locked until you enable it.");
    } else if (reviewSelected > 0 && state.settings.enablePermanentDelete) {
      detailText = ACP.t(strings, "selectionHintReview", "Review rows still need extra scrutiny before permanent delete.");
    } else if (selectedRows.length && state.settings.enablePermanentDelete) {
      detailText = ACP.t(strings, "selectionHintDeleteMode", "Permanent delete requires typed confirmation.");
    } else if (selectedRows.length) {
      detailText = ACP.t(strings, "selectionHintQuarantineMode", "Selected folders will be moved into quarantine instead of being permanently deleted.");
    }

    els.$selectionSummary.text(summaryText);
    els.$selectionDetail.text(detailText);
    els.$primaryAction.text(getPrimaryActionLabel());
    els.$primaryAction.prop("disabled", state.busy || !state.scanToken || selectedRows.length === 0);
    els.$dryRun.prop("disabled", state.busy || !state.scanToken || selectedRows.length === 0);
    els.$selectVisible.prop("disabled", state.busy || visibleSelectableCount === 0);
    els.$clearSelection.prop("disabled", state.busy || selectedRows.length === 0);
    els.$doneBottom.prop("disabled", state.busy);
  }

  function getSelectedRows() {
    return $.grep(state.rows, function(row) {
      return !!state.selected[row.id] && row.canDelete;
    });
  }

  function clearFilters() {
    state.riskFilter = "all";
    state.showIgnored = false;
    els.$search.val("");
    els.$riskFilter.val("all");
    els.$showIgnored.prop("checked", false);
    renderResults();
    renderResultsMeta();
    updateActionBar();
  }

  function saveSafetySettings() {
    var previousSettings = $.extend({}, ACP.defaultSafetySettings(), state.settings || {});
    var previousRows = state.rows.slice(0);
    var previousSummary = $.extend({}, state.summary || {});
    var nextSettings = $.extend({}, previousSettings, {
      allowOutsideShareCleanup: !!els.$allowExternal.prop("checked"),
      enablePermanentDelete: !!els.$enableDelete.prop("checked")
    });

    state.settings = nextSettings;
    syncSafetyControls();
    renderPanels();
    updateActionBar();

    if (!state.scanToken) {
      loadScan();
      return;
    }

    setBusy(true);

    apiPost({
      action: "saveSafetySettings",
      scanToken: state.scanToken,
      allowOutsideShareCleanup: nextSettings.allowOutsideShareCleanup ? "1" : "0",
      enablePermanentDelete: nextSettings.enablePermanentDelete ? "1" : "0"
    }).done(function(response) {
      state.settings = $.extend({}, ACP.defaultSafetySettings(), response.settings || nextSettings);
      syncSafetyControls();
      applyLocalSafetyState();
      reconcileSelection();
      setBusy(false);
      renderAll();
    }).fail(function(xhr) {
      state.settings = previousSettings;
      state.rows = previousRows;
      state.summary = previousSummary;
      syncSafetyControls();
      setBusy(false);
      swal(ACP.t(strings, "settingsSaveFailedTitle", "Safety settings failed"), ACP.extractErrorMessage(xhr, ACP.t(strings, "settingsSaveFailedMessage", "The new safety settings could not be saved right now.")), "error");
      if (xhr && xhr.status === 409) {
        loadScan();
      } else {
        renderAll();
        updateActionBar();
      }
    });
  }

  function postRowAction(action, rowId) {
    var intent = action === "unignore" ? "unignore" : "ignore";
    var failureTitle = action === "unignore" ? ACP.t(strings, "restoreFailedTitle", "Restore failed") : ACP.t(strings, "ignoreFailedTitle", "Ignore failed");
    var failureMessage = action === "unignore" ? ACP.t(strings, "restoreFailedMessage", "The ignore list could not be updated right now.") : ACP.t(strings, "ignoreFailedMessage", "The ignore list could not be updated right now.");

    setBusy(true);

    apiPost({
      action: "updateCandidateState",
      scanToken: state.scanToken,
      candidateIds: JSON.stringify([rowId]),
      intent: intent
    }).done(function() {
      loadScan();
    }).fail(function(xhr) {
      setBusy(false);
      swal(failureTitle, ACP.extractErrorMessage(xhr, failureMessage), "error");
      if (xhr && xhr.status === 409) {
        loadScan();
      }
    });
  }

  function buildOperationContext(operation) {
    var baseOperation = String(operation || "").replace(/^preview_/, "");
    var preview = baseOperation !== operation;
    var isDelete = baseOperation === "delete";

    return {
      operation: operation,
      preview: preview,
      baseOperation: baseOperation,
      confirmTitle: isDelete ? ACP.t(strings, "deleteConfirmTitle", "Delete selected folders?") : ACP.t(strings, "quarantineConfirmTitle", "Quarantine selected folders?"),
      confirmMessage: isDelete ? ACP.t(strings, "deleteConfirmMessage", "Selected folders will be removed immediately.") : ACP.t(strings, "quarantineConfirmMessage", "Selected folders will be moved into quarantine instead of being permanently deleted."),
      detailMessage: isDelete ? ACP.t(strings, "deleteIrreversibleMessage", "This action cannot be undone by this plugin.") : ACP.t(strings, "quarantineDetailMessage", "The selected folders will be moved into the quarantine root instead of being permanently deleted."),
      confirmButtonLabel: isDelete ? ACP.t(strings, "deleteConfirmButton", "Delete") : ACP.t(strings, "quarantineConfirmButton", "Quarantine"),
      loadingTitle: preview ? ACP.t(strings, "dryRunTitle", "Running dry run") : (isDelete ? ACP.t(strings, "deletingTitle", "Deleting selected folders") : ACP.t(strings, "quarantiningTitle", "Moving selected folders to quarantine")),
      loadingMessage: preview ? ACP.t(strings, "dryRunMessage", "Reviewing what the current action would do without changing anything.") : (isDelete ? ACP.t(strings, "deletingMessage", "Large folders can take a moment to remove.") : ACP.t(strings, "quarantiningMessage", "Selected folders are being moved into a hidden quarantine root.")),
      resultTitleSuccess: preview ? ACP.t(strings, "dryRunResultTitleSuccess", "Dry run complete") : (isDelete ? ACP.t(strings, "deleteResultTitleSuccess", "Cleanup complete") : ACP.t(strings, "quarantineResultTitleSuccess", "Quarantine complete")),
      resultTitleWarning: preview ? ACP.t(strings, "dryRunResultTitleWarning", "Dry run finished with warnings") : (isDelete ? ACP.t(strings, "deleteResultTitleWarning", "Cleanup finished with warnings") : ACP.t(strings, "quarantineResultTitleWarning", "Quarantine finished with warnings")),
      failureTitle: isDelete ? ACP.t(strings, "deleteFailedTitle", "Delete failed") : ACP.t(strings, "quarantineFailedTitle", "Quarantine failed"),
      listTitle: preview ? ACP.t(strings, "previewListTitle", "Operation preview") : (isDelete ? ACP.t(strings, "deleteListTitle", "Folders to delete") : ACP.t(strings, "quarantineListTitle", "Folders to quarantine")),
      successStatus: preview ? "ready" : (isDelete ? "deleted" : "quarantined"),
      warningLabel: preview ? ACP.t(strings, "previewWarningLabel", "DRY RUN") : ACP.t(strings, "deleteWarningLabel", "WARNING")
    };
  }

  function buildActionConfirmButtonText(context, count) {
    var noun = count === 1 ? ACP.t(strings, "deleteFolderSingular", "folder") : ACP.t(strings, "deleteFolderPlural", "folders");
    return context.confirmButtonLabel + " " + count + " " + noun;
  }

  function buildOperationPreviewHtml(rows, context, options) {
    var settings = options || {};
    var reviewCount = typeof settings.reviewCount === "number" ? settings.reviewCount : $.grep(rows, function(row) {
      return row.risk === "review";
    }).length;
    var safeCount = Math.max(0, rows.length - reviewCount);
    var preview = rows.slice(0, 6);
    var html = [
      '<div class="acp-modal-summary">',
      '<div class="acp-modal-flag">' + ACP.escapeHtml(ACP.t(strings, "deleteWarningLabel", "WARNING")) + "</div>",
      '<div class="acp-modal-copy">',
      '<div class="acp-modal-lead">' + ACP.escapeHtml(context.confirmMessage) + "</div>",
      '<div class="acp-modal-subcopy">' + ACP.escapeHtml(context.detailMessage) + "</div>",
      "</div>",
      '<div class="acp-modal-stats">',
      '<span class="acp-modal-stat is-selected">' + ACP.escapeHtml(String(rows.length)) + " selected</span>",
      '<span class="acp-modal-stat is-safe">' + ACP.escapeHtml(ACP.t(strings, "deleteSafeLabel", "Safe")) + ": " + ACP.escapeHtml(String(safeCount)) + "</span>"
    ];

    if (reviewCount > 0) {
      html.push('<span class="acp-modal-stat is-review">' + ACP.escapeHtml(ACP.t(strings, "deleteReviewCountLabel", "Review")) + ": " + ACP.escapeHtml(String(reviewCount)) + "</span>");
    }

    html.push("</div>");

    if (reviewCount > 0) {
      html.push(
        '<div class="acp-modal-warning-box">' +
          '<strong>' + ACP.escapeHtml(ACP.t(strings, "deleteReviewLabel", "Review required")) + ".</strong> " +
          ACP.escapeHtml(ACP.t(strings, "deleteTypedMessage", "One or more selected folders sit outside the configured appdata share.")) +
        "</div>"
      );
    }

    if (settings.showTypeHint) {
      html.push('<div class="acp-modal-hint">' + ACP.escapeHtml(ACP.t(strings, "deleteTypedHint", "Type DELETE to continue with this permanent delete.")) + "</div>");
    }

    html.push('<div class="acp-modal-panel">');
    html.push('<div class="acp-modal-panel-title">' + ACP.escapeHtml(context.listTitle) + "</div>");
    html.push('<ul class="acp-modal-list">');

    $.each(preview, function(_, row) {
      html.push('<li><code class="acp-modal-path">' + ACP.escapeHtml(row.displayPath || row.path || "") + "</code></li>");
    });

    if (rows.length > preview.length) {
      html.push('<li class="acp-modal-list-more">+' + ACP.escapeHtml(String(rows.length - preview.length)) + " more</li>");
    }

    html.push("</ul></div></div>");
    return html.join("");
  }

  function buildOperationResultsHtml(summary, results, context) {
    var stats = [];
    var html = ['<div class="acp-modal-summary">'];

    if (context.preview) {
      html.push('<div class="acp-modal-flag is-preview">' + ACP.escapeHtml(context.warningLabel) + "</div>");
      stats.push('<span class="acp-modal-stat is-selected">' + ACP.escapeHtml(ACP.t(strings, "previewReadyLabel", "Ready")) + ": " + ACP.escapeHtml(String(summary.ready || 0)) + "</span>");
    } else if (context.baseOperation === "delete") {
      stats.push('<span class="acp-modal-stat is-selected">' + ACP.escapeHtml(ACP.t(strings, "resultDeletedLabel", "Deleted")) + ": " + ACP.escapeHtml(String(summary.deleted || 0)) + "</span>");
    } else {
      stats.push('<span class="acp-modal-stat is-safe">' + ACP.escapeHtml(ACP.t(strings, "resultQuarantinedLabel", "Quarantined")) + ": " + ACP.escapeHtml(String(summary.quarantined || 0)) + "</span>");
    }

    stats.push('<span class="acp-modal-stat is-review">' + ACP.escapeHtml(ACP.t(strings, "resultBlockedLabel", "Blocked")) + ": " + ACP.escapeHtml(String(summary.blocked || 0)) + "</span>");
    stats.push('<span class="acp-modal-stat">' + ACP.escapeHtml(ACP.t(strings, "resultMissingLabel", "Missing")) + ": " + ACP.escapeHtml(String(summary.missing || 0)) + "</span>");
    stats.push('<span class="acp-modal-stat">' + ACP.escapeHtml(ACP.t(strings, "resultErrorLabel", "Error")) + ": " + ACP.escapeHtml(String(summary.errors || 0)) + "</span>");

    html.push('<div class="acp-modal-stats">' + stats.join("") + "</div>");
    html.push('<div class="acp-modal-panel">');
    html.push('<div class="acp-modal-panel-title">' + ACP.escapeHtml(context.listTitle) + "</div>");
    html.push('<ul class="acp-modal-list acp-modal-result-list">');

    $.each(results || [], function(_, result) {
      var statusMeta = ACP.formatOperationResultStatus(strings, result.status);
      var destinationHtml = "";
      var messageHtml = result.message ? '<div class="acp-modal-result-message">' + ACP.escapeHtml(result.message) + "</div>" : "";

      if (result.destination) {
        destinationHtml =
          '<div class="acp-modal-result-destination">' +
            '<span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "destinationLabel", "Destination")) + "</span>" +
            '<code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(result.destination) + "</code>" +
          "</div>";
      }

      html.push(
        '<li class="acp-modal-result">' +
          '<div class="acp-modal-result-head">' +
            '<span class="acp-modal-stat ' + statusMeta.tone + '">' + ACP.escapeHtml(statusMeta.label) + "</span>" +
            '<code class="acp-modal-path">' + ACP.escapeHtml(result.displayPath || result.path || "") + '</code>' +
          "</div>" +
          messageHtml +
          destinationHtml +
        "</li>"
      );
    });

    html.push("</ul></div></div>");
    return html.join("");
  }

  function startDryRunFlow() {
    var selectedRows = getSelectedRows();

    if (!selectedRows.length) {
      swal(ACP.t(strings, "deleteEmptyTitle", "Nothing selected"), ACP.t(strings, "deleteEmptyMessage", "Select at least one deletable folder before continuing."), "warning");
      return;
    }

    runCandidateOperation(selectedRows, "preview_" + getPrimaryOperation());
  }

  function startPrimaryActionFlow() {
    var selectedRows = getSelectedRows();
    var reviewRows = $.grep(selectedRows, function(row) {
      return row.risk === "review";
    });
    var context = buildOperationContext(getPrimaryOperation());
    var confirmButtonText = buildActionConfirmButtonText(context, selectedRows.length);

    if (!selectedRows.length) {
      swal(ACP.t(strings, "deleteEmptyTitle", "Nothing selected"), ACP.t(strings, "deleteEmptyMessage", "Select at least one deletable folder before continuing."), "warning");
      return;
    }

    if (context.baseOperation === "delete") {
      swal({
        title: ACP.t(strings, "deleteTypedTitle", "Type DELETE to confirm permanent delete"),
        text: "",
        type: "input",
        html: true,
        showCancelButton: true,
        closeOnConfirm: false,
        inputPlaceholder: ACP.t(strings, "deleteTypedPlaceholder", "DELETE"),
        confirmButtonText: confirmButtonText
      }, function(inputValue) {
        if (inputValue === false) {
          return false;
        }

        if ($.trim(String(inputValue || "")).toUpperCase() !== "DELETE") {
          swal.showInputError(ACP.t(strings, "deleteTypedError", "Type DELETE to continue."));
          return false;
        }

        runCandidateOperation(selectedRows, context.operation);
        return true;
      });
      ACP.applyDeleteModalClass("acp-delete-modal acp-delete-modal-review", buildOperationPreviewHtml(selectedRows, context, {
        reviewCount: reviewRows.length,
        showTypeHint: true
      }));
      return;
    }

    swal({
      title: context.confirmTitle,
      text: "",
      type: "warning",
      html: true,
      showCancelButton: true,
      closeOnConfirm: false,
      confirmButtonText: confirmButtonText
    }, function() {
      runCandidateOperation(selectedRows, context.operation);
    });
    ACP.applyDeleteModalClass("acp-delete-modal", buildOperationPreviewHtml(selectedRows, context, {
      reviewCount: 0,
      showTypeHint: false
    }));
  }

  function runCandidateOperation(selectedRows, operation) {
    var context = buildOperationContext(operation);

    setBusy(true);
    ACP.applyDeleteModalClass("");
    swal({
      title: context.loadingTitle,
      text: context.loadingMessage,
      type: "info",
      showConfirmButton: false,
      allowEscapeKey: false,
      allowOutsideClick: false
    });

    apiPost({
      action: "executeCandidateAction",
      scanToken: state.scanToken,
      candidateIds: JSON.stringify($.map(selectedRows, function(row) {
        return row.id;
      })),
      operation: operation
    }).done(function(response) {
      var summary = response.summary || { ready: 0, quarantined: 0, deleted: 0, missing: 0, blocked: 0, errors: 0 };
      var results = $.isArray(response.results) ? response.results : [];
      var hasWarnings = Number(summary.blocked || 0) > 0 || Number(summary.missing || 0) > 0 || Number(summary.errors || 0) > 0;
      var modalTitle = hasWarnings ? context.resultTitleWarning : context.resultTitleSuccess;
      var modalType = hasWarnings ? "warning" : "success";

      setBusy(false);

      if (!context.preview) {
        state.selected = {};
      }

      if (response.quarantineSummary) {
        state.quarantine.summary = $.extend({ count: 0, sizeLabel: "0 B" }, response.quarantineSummary);
      }

      swal({
        title: modalTitle,
        text: "",
        type: modalType,
        html: true
      }, function() {
        if (!context.preview) {
          loadScan();
          if (state.quarantine.open) {
            loadQuarantineManager(true);
          }
        }
      });
      ACP.applyDeleteModalClass("acp-delete-modal acp-delete-results-modal", buildOperationResultsHtml(summary, results, context));
      renderPanels();
      renderSummaryCards();
      updateActionBar();
    }).fail(function(xhr) {
      var fallbackMessage = ACP.extractErrorMessage(xhr, ACP.t(strings, "scanFailedMessage", "The orphaned appdata scan could not be completed right now."));

      setBusy(false);

      if (xhr && xhr.status === 409) {
        swal({
          title: context.failureTitle,
          text: fallbackMessage,
          type: "error"
        }, function() {
          loadScan();
        });
        return;
      }

      swal(context.failureTitle, fallbackMessage, "error");
    });
  }

  function findQuarantineEntry(entryId) {
    var matches = $.grep(state.quarantine.entries || [], function(entry) {
      return String(entry.id || "") === String(entryId || "");
    });

    return matches.length ? matches[0] : null;
  }

  function buildQuarantineActionConfirmHtml(entry, action) {
    var title = action === "restore"
      ? ACP.t(strings, "quarantineRestoreConfirmMessage", "Restore this quarantined folder back to its original location.")
      : ACP.t(strings, "quarantinePurgeConfirmMessage", "Permanently delete this quarantined folder.");
    var listTitle = action === "restore"
      ? ACP.t(strings, "quarantineRestoreListTitle", "Folder to restore")
      : ACP.t(strings, "quarantinePurgeListTitle", "Folder to purge");

    return [
      '<div class="acp-modal-summary">',
      '<div class="acp-modal-flag">' + ACP.escapeHtml(action === "restore" ? ACP.t(strings, "quarantineRestoreActionLabel", "Restore") : ACP.t(strings, "quarantinePurgeActionLabel", "Purge")) + "</div>",
      '<div class="acp-modal-copy">',
      '<div class="acp-modal-lead">' + ACP.escapeHtml(title) + "</div>",
      "</div>",
      '<div class="acp-modal-panel">',
      '<div class="acp-modal-panel-title">' + ACP.escapeHtml(listTitle) + "</div>",
      '<code class="acp-modal-path">' + ACP.escapeHtml((entry && entry.sourcePath) || "") + "</code>",
      "</div>",
      "</div>"
    ].join("");
  }

  function buildQuarantineManagerResultsHtml(action, summary, results) {
    var html = ['<div class="acp-modal-summary">'];
    var actionLabel = action === "restore" ? ACP.t(strings, "quarantineRestoreActionLabel", "Restore") : ACP.t(strings, "quarantinePurgeActionLabel", "Purge");

    html.push('<div class="acp-modal-flag">' + ACP.escapeHtml(actionLabel) + "</div>");
    html.push('<div class="acp-modal-stats">');
    $.each(summary || {}, function(status, count) {
      var statusMeta;
      if (!count) {
        return;
      }
      statusMeta = ACP.formatOperationResultStatus(strings, status);
      html.push('<span class="acp-modal-stat ' + ACP.escapeHtml(statusMeta.tone) + '">' + ACP.escapeHtml(statusMeta.label) + ": " + ACP.escapeHtml(String(count)) + "</span>");
    });
    html.push("</div>");
    html.push('<div class="acp-modal-panel">');
    html.push('<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "quarantineManagerTitle", "Quarantine manager")) + "</div>");
    html.push('<ul class="acp-modal-list acp-modal-result-list">');

    $.each(results || [], function(_, result) {
      var statusMeta = ACP.formatOperationResultStatus(strings, result.status);
      html.push('<li class="acp-modal-result">');
      html.push('<div class="acp-modal-result-head"><span class="acp-modal-stat ' + ACP.escapeHtml(statusMeta.tone) + '">' + ACP.escapeHtml(statusMeta.label) + "</span><code class=\"acp-modal-path\">" + ACP.escapeHtml(result.sourcePath || result.destination || "") + "</code></div>");
      if (result.destination) {
        html.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "destinationLabel", "Destination")) + '</span><code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(result.destination) + "</code></div>");
      }
      if (result.message) {
        html.push('<div class="acp-modal-result-message">' + ACP.escapeHtml(result.message) + "</div>");
      }
      html.push("</li>");
    });

    html.push("</ul></div></div>");
    return html.join("");
  }

  function startQuarantineManagerActionFlow(action, entryId) {
    var entry = findQuarantineEntry(entryId);
    var isRestore = action === "restore";
    var confirmTitle = isRestore
      ? ACP.t(strings, "quarantineRestoreConfirmTitle", "Restore quarantined folder?")
      : ACP.t(strings, "quarantinePurgeConfirmTitle", "Purge quarantined folder?");
    var confirmButton = isRestore
      ? ACP.t(strings, "quarantineRestoreActionLabel", "Restore")
      : ACP.t(strings, "quarantinePurgeActionLabel", "Purge");

    if (!entry) {
      loadQuarantineManager(true);
      return;
    }

    if (!isRestore) {
      swal({
        title: ACP.t(strings, "quarantinePurgeTypedTitle", "Type DELETE to purge"),
        text: "",
        type: "input",
        html: true,
        showCancelButton: true,
        closeOnConfirm: false,
        inputPlaceholder: ACP.t(strings, "deleteTypedPlaceholder", "DELETE"),
        confirmButtonText: confirmButton
      }, function(inputValue) {
        if (inputValue === false) {
          return false;
        }

        if ($.trim(String(inputValue || "")).toUpperCase() !== "DELETE") {
          swal.showInputError(ACP.t(strings, "deleteTypedError", "Type DELETE to continue."));
          return false;
        }

        runQuarantineManagerAction([entryId], action);
        return true;
      });
      ACP.applyDeleteModalClass("acp-delete-modal acp-delete-modal-review", buildQuarantineActionConfirmHtml(entry, action));
      return;
    }

    swal({
      title: confirmTitle,
      text: "",
      type: "warning",
      html: true,
      showCancelButton: true,
      closeOnConfirm: false,
      confirmButtonText: confirmButton
    }, function() {
      runQuarantineManagerAction([entryId], action);
    });
    ACP.applyDeleteModalClass("acp-delete-modal", buildQuarantineActionConfirmHtml(entry, action));
  }

  function runQuarantineManagerAction(entryIds, action) {
    var isRestore = action === "restore";
    var loadingTitle = isRestore
      ? ACP.t(strings, "quarantineRestoreLoadingTitle", "Restoring quarantined folders")
      : ACP.t(strings, "quarantinePurgeLoadingTitle", "Purging quarantined folders");
    var loadingMessage = isRestore
      ? ACP.t(strings, "quarantineRestoreLoadingMessage", "Moving selected folders back to their original locations.")
      : ACP.t(strings, "quarantinePurgeLoadingMessage", "Permanently deleting selected quarantined folders.");
    var failureTitle = isRestore
      ? ACP.t(strings, "quarantineRestoreFailedTitle", "Restore failed")
      : ACP.t(strings, "quarantinePurgeFailedTitle", "Purge failed");

    setBusy(true);
    state.quarantine.loading = true;
    renderPanels();
    ACP.applyDeleteModalClass("");
    swal({
      title: loadingTitle,
      text: loadingMessage,
      type: "info",
      showConfirmButton: false,
      allowEscapeKey: false,
      allowOutsideClick: false
    });

    apiPost({
      action: "quarantineManagerAction",
      managerAction: action,
      entryIds: JSON.stringify(entryIds)
    }).done(function(response) {
      var quarantine = response.quarantine || {};
      var summary = response.summary || { restored: 0, purged: 0, missing: 0, blocked: 0, errors: 0 };
      var results = $.isArray(response.results) ? response.results : [];
      var hasWarnings = Number(summary.blocked || 0) > 0 || Number(summary.missing || 0) > 0 || Number(summary.errors || 0) > 0;
      var successTitle = isRestore
        ? ACP.t(strings, "quarantineRestoreSuccessTitle", "Restore complete")
        : ACP.t(strings, "quarantinePurgeSuccessTitle", "Purge complete");
      var warningTitle = isRestore
        ? ACP.t(strings, "quarantineRestoreWarningTitle", "Restore finished with warnings")
        : ACP.t(strings, "quarantinePurgeWarningTitle", "Purge finished with warnings");

      state.quarantine.entries = $.isArray(quarantine.entries) ? quarantine.entries : [];
      state.quarantine.summary = $.extend({ count: 0, sizeLabel: "0 B" }, quarantine.summary || {});
      state.quarantine.loaded = true;
      state.quarantine.loading = false;
      setBusy(false);
      renderPanels();

      swal({
        title: hasWarnings ? warningTitle : successTitle,
        text: "",
        type: hasWarnings ? "warning" : "success",
        html: true
      }, function() {
        loadScan();
        if (state.quarantine.open) {
          loadQuarantineManager(true);
        }
      });
      ACP.applyDeleteModalClass("acp-delete-modal acp-delete-results-modal", buildQuarantineManagerResultsHtml(action, summary, results));
    }).fail(function(xhr) {
      state.quarantine.loading = false;
      setBusy(false);
      renderPanels();

      if (xhr && xhr.status === 409) {
        loadQuarantineManager(true);
      }

      swal(failureTitle, ACP.extractErrorMessage(xhr, ACP.t(strings, "quarantineManagerActionFailedMessage", "The quarantine manager action could not be completed right now.")), "error");
    });
  }
})(window, document, jQuery);
