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
    auditHistory: [],
    auditOpen: false,
    scanWarningMessage: "",
    settings: ACP.defaultSafetySettings(),
    appdataSources: {
      detected: [],
      manual: [],
      effective: [],
      zfsPathMappings: []
    },
    appdataSourceBrowser: defaultAppdataSourceBrowserState(),
    zfsPathMappingBrowser: defaultZfsPathMappingBrowserState(),
    quarantine: {
      loading: false,
      loaded: false,
      entries: [],
      selected: {},
      summary: { count: 0, sizeLabel: "0 B" },
      purgeAtInput: "",
      restoreConflict: null
    },
    scanHydration: {
      active: false,
      queue: [],
      batchSize: 8,
      requestToken: ""
    },
    riskFilter: "all",
    sortMode: "risk",
    showIgnored: false,
    badgeFilter: null,
    busy: false
  };
  var els = {};

  $(init);

  function defaultAppdataSourceBrowserState() {
    return {
      loading: false,
      loaded: false,
      root: "/mnt",
      currentPath: "",
      parentPath: "",
      breadcrumbs: [],
      entries: [],
      canAdd: false,
      validationMessage: "",
      feedbackMessage: "",
      requestToken: "",
      manual: []
    };
  }

  function defaultZfsPathMappingBrowserState() {
    return {
      loading: false,
      loaded: false,
      root: "/mnt",
      currentPath: "",
      parentPath: "",
      breadcrumbs: [],
      entries: [],
      requestToken: "",
      activeField: "shareRoot",
      draft: {
        shareRoot: "",
        datasetRoot: ""
      },
      mappings: [],
      feedbackMessage: ""
    };
  }

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
    els.$enableZfsDelete = $("#acp-enable-zfs-delete");
    els.$sort = $("#acp-sort");
    els.$rescan = $("#acp-rescan");
    els.$selectVisible = $("#acp-select-visible");
    els.$clearSelection = $("#acp-clear-selection");
    els.$selectAll = $("#acp-select-all");
    els.$dryRun = $("#acp-dry-run");
    els.$primaryAction = $("#acp-primary-action");
    els.$resultsMeta = $("#acp-results-meta");
    els.$modeStrip = $("#acp-mode-strip");
    els.$scanSummary = $("#acp-scan-summary");
    els.$notices = $("#acp-notices");
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

    els.$selectAll.on("click", function() {
      if (!state.busy) {
        selectAllRows();
      }
    });
    els.$dryRun.on("click", startDryRunFlow);
    els.$primaryAction.on("click", startPrimaryActionFlow);

    els.$allowExternal.on("change", saveSafetySettings);
    els.$enableDelete.on("change", saveSafetySettings);
    els.$enableZfsDelete.on("change", saveSafetySettings);

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

    els.$results.on("click", ".acp-badge-filter", handleBadgeFilterClick);
    els.$resultsMeta.on("click", ".acp-badge-filter", handleBadgeFilterClick);
    els.$results.on("keydown", ".acp-badge-filter", handleBadgeFilterKeydown);
    els.$resultsMeta.on("keydown", ".acp-badge-filter", handleBadgeFilterKeydown);

    els.$results.on("click", ".acp-row-action", function(event) {
      var action = $(this).data("row-action");
      var rowId = $(this).data("row-id");

      event.preventDefault();
      event.stopPropagation();

      if (!action || !rowId || state.busy) {
        return;
      }

      if (action === "details") {
        openRowDetailsModal(findRowById(rowId));
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
        openQuarantineManagerModal(false);
      }
    });

    els.$modeStrip.on("click", "[data-action='open-appdata-sources']", function() {
      if (!state.busy) {
        openAppdataSourcesModal();
      }
    });

    els.$modeStrip.on("click", "[data-action='open-zfs-path-mappings']", function() {
      if (!state.busy) {
        openZfsPathMappingsModal();
      }
    });

    els.$modeStrip.on("click", "[data-action='toggle-lock-override']", function() {
      var intent = String($(this).data("lock-intent") || "unlock");

      if (!state.busy) {
        startSelectedLockOverrideFlow(intent);
      }
    });

    els.$modeStrip.on("click", "[data-action='open-audit-history']", function() {
      if (!state.busy) {
        openAuditHistoryModal();
      }
    });

    els.$modeStrip.on("click", "[data-action='open-tools']", function() {
      if (!state.busy) {
        openToolsModal();
      }
    });

    $(document).on("click.acpQuarantine", ".sweet-alert [data-action='refresh-quarantine']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!state.busy && !state.quarantine.loading) {
        openQuarantineManagerModal(true);
      }
    });

    $(document).on("click.acpQuarantine", ".sweet-alert [data-action='clear-quarantine-selection']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (state.busy || state.quarantine.loading) {
        return;
      }

      clearQuarantineSelection();
    });

    $(document).on("click.acpQuarantine", ".sweet-alert [data-action='select-all-quarantine']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (state.busy || state.quarantine.loading) {
        return;
      }

      selectAllQuarantineEntries();
    });

    $(document).on("click.acpQuarantine", ".sweet-alert [data-action='set-quarantine-purge-schedule'], .sweet-alert [data-action='clear-quarantine-purge-schedule']", function(event) {
      var mode = $(this).data("action") === "clear-quarantine-purge-schedule" ? "clear" : "set";

      event.preventDefault();
      event.stopPropagation();

      if (state.busy || state.quarantine.loading) {
        return;
      }

      startQuarantinePurgeScheduleFlow(mode, getSelectedQuarantineEntryIds());
    });

    $(document).on("click.acpQuarantine", ".sweet-alert [data-action='restore-selected-quarantine'], .sweet-alert [data-action='purge-selected-quarantine']", function(event) {
      var action = $(this).data("action") === "restore-selected-quarantine" ? "restore" : "purge";

      event.preventDefault();
      event.stopPropagation();

      if (state.busy || state.quarantine.loading) {
        return;
      }

      startQuarantineManagerActionFlow(action, getSelectedQuarantineEntryIds());
    });

    $(document).on("click.acpQuarantine", ".sweet-alert [data-action='resolve-restore-conflicts']", function(event) {
      var conflictMode = String($(this).data("conflict-mode") || "");
      var restoreConflict = state.quarantine.restoreConflict || {};
      var entryIds = $.isArray(restoreConflict.entryIds) ? restoreConflict.entryIds : [];
      var customRestoreNames = {};

      event.preventDefault();
      event.stopPropagation();

      if (state.busy || !entryIds.length || !conflictMode) {
        return;
      }

      if (conflictMode === "custom") {
        customRestoreNames = collectRestoreConflictNames();
        if (!customRestoreNames) {
          return;
        }
      }

      state.quarantine.restoreConflict = null;
      runQuarantineManagerAction(entryIds, "restore", {
        restoreConflictMode: conflictMode,
        restoreConflictNames: customRestoreNames
      });
    });

    $(document).on("input.acpQuarantine", ".sweet-alert .acp-restore-conflict-name", function() {
      updateRestoreConflictPreview($(this));
      setRestoreConflictFeedback("");
    });

    $(document).on("change.acpQuarantine", ".sweet-alert .acp-quarantine-default-purge-input", function(event) {
      var nextDays = normalizeDefaultQuarantinePurgeDaysValue($(this).val());

      event.preventDefault();
      event.stopPropagation();

      if (nextDays === null) {
        $(this).val(String(state.settings.defaultQuarantinePurgeDays || 0));
        swal(
          ACP.t(strings, "quarantineDefaultPurgeDaysFailedTitle", "Default purge setting failed"),
          ACP.t(strings, "quarantineDefaultPurgeDaysInvalidMessage", "Enter a whole number of days from 0 to 3650."),
          "warning"
        );
        return;
      }

      if (nextDays === Number(state.settings.defaultQuarantinePurgeDays || 0)) {
        return;
      }

      saveSafetySettings({
        defaultQuarantinePurgeDays: nextDays
      }, {
        syncQuarantineModal: true,
        resetQuarantineScheduleInput: true,
        reopenQuarantineModalOnFailure: true,
        failureTitle: ACP.t(strings, "quarantineDefaultPurgeDaysFailedTitle", "Default purge setting failed"),
        failureMessage: ACP.t(strings, "quarantineDefaultPurgeDaysFailedMessage", "The default quarantine purge timer could not be updated right now.")
      });
    });

    $(document).on("input.acpQuarantine change.acpQuarantine", ".sweet-alert .acp-quarantine-schedule-at-input", function() {
      state.quarantine.purgeAtInput = $.trim(String($(this).val() || ""));
    });

    $(document).on("click.acpQuarantine", ".sweet-alert .acp-quarantine-entry", function(event) {
      var $checkbox;

      if (state.busy || state.quarantine.loading) {
        return;
      }

      if ($(event.target).closest(".acp-quarantine-checkbox, .acp-button, button, input, label, code, a").length) {
        return;
      }

      $checkbox = $(this).find(".acp-quarantine-checkbox:not(:disabled)").first();
      if (!$checkbox.length) {
        return;
      }

      $checkbox.prop("checked", !$checkbox.prop("checked")).trigger("change");
    });

    $(document).on("change.acpQuarantine", ".sweet-alert .acp-quarantine-checkbox", function() {
      var entryId = String($(this).data("entry-id") || "");

      if (!entryId || state.busy || state.quarantine.loading) {
        return;
      }

      if (this.checked) {
        state.quarantine.selected[entryId] = true;
      } else {
        delete state.quarantine.selected[entryId];
      }

      syncQuarantineManagerSelectionUi();
    });

    $(document).on("click.acpSources", ".sweet-alert [data-action='save-appdata-sources']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!state.busy) {
        saveAppdataSourcesFromModal();
      }
    });

    $(document).on("click.acpSources", ".sweet-alert [data-action='browse-appdata-source']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!state.busy && !state.appdataSourceBrowser.loading) {
        loadAppdataSourceBrowser($(this).data("path"));
      }
    });

    $(document).on("click.acpSources", ".sweet-alert [data-action='browse-appdata-source-parent']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!state.busy && !state.appdataSourceBrowser.loading && state.appdataSourceBrowser.parentPath) {
        loadAppdataSourceBrowser(state.appdataSourceBrowser.parentPath);
      }
    });

    $(document).on("click.acpTools", ".sweet-alert [data-action='export-diagnostics']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!state.busy) {
        exportDiagnostics();
      }
    });

    $(document).on("keydown.acpSources", ".sweet-alert .acp-appdata-browser-entry[data-action]", function(event) {
      var key = String(event.key || "");

      if (key !== "Enter" && key !== " ") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      $(this).trigger("click");
    });

    $(document).on("click.acpSources", ".sweet-alert [data-action='add-current-appdata-source']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!state.busy && !state.appdataSourceBrowser.loading) {
        addCurrentAppdataSourceFromBrowser();
      }
    });

    $(document).on("click.acpSources", ".sweet-alert [data-action='remove-manual-appdata-source']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!state.busy && !state.appdataSourceBrowser.loading) {
        removeManualAppdataSourceFromBrowser($(this).data("path"));
      }
    });

    $(document).on("click.acpZfsMappings", ".sweet-alert [data-action='save-zfs-path-mappings']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!state.busy) {
        saveZfsPathMappingsFromModal();
      }
    });

    $(document).on("click.acpZfsMappings", ".sweet-alert [data-action='browse-zfs-mapping-path']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!state.busy && !state.zfsPathMappingBrowser.loading) {
        loadZfsPathMappingBrowser($(this).data("path"));
      }
    });

    $(document).on("click.acpZfsMappings", ".sweet-alert [data-action='browse-zfs-mapping-parent']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!state.busy && !state.zfsPathMappingBrowser.loading && state.zfsPathMappingBrowser.parentPath) {
        loadZfsPathMappingBrowser(state.zfsPathMappingBrowser.parentPath);
      }
    });

    $(document).on("keydown.acpZfsMappings", ".sweet-alert .acp-appdata-browser-entry[data-action='browse-zfs-mapping-path'], .sweet-alert .acp-appdata-browser-entry[data-action='browse-zfs-mapping-parent']", function(event) {
      var key = String(event.key || "");

      if (key !== "Enter" && key !== " ") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      $(this).trigger("click");
    });

    $(document).on("click.acpZfsMappings", ".sweet-alert [data-action='set-zfs-browser-field']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!state.busy && !state.zfsPathMappingBrowser.loading) {
        setCurrentZfsPathMappingField($(this).data("field"));
      }
    });

    $(document).on("click.acpZfsMappings", ".sweet-alert [data-action='use-current-zfs-mapping-path']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!state.busy && !state.zfsPathMappingBrowser.loading) {
        assignCurrentZfsPathMappingBrowserPath();
      }
    });

    $(document).on("click.acpZfsMappings", ".sweet-alert [data-action='add-zfs-path-mapping']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!state.busy && !state.zfsPathMappingBrowser.loading) {
        addZfsPathMappingFromDraft();
      }
    });

    $(document).on("click.acpZfsMappings", ".sweet-alert [data-action='clear-zfs-mapping-draft']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!state.busy && !state.zfsPathMappingBrowser.loading) {
        clearZfsPathMappingDraft();
      }
    });

    $(document).on("click.acpZfsMappings", ".sweet-alert [data-action='remove-zfs-path-mapping']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!state.busy && !state.zfsPathMappingBrowser.loading) {
        removeZfsPathMappingFromBrowser($(this).data("shareRoot"), $(this).data("datasetRoot"));
      }
    });

    $(document).on("click.acpQuarantine", ".sweet-alert [data-entry-action]", function(event) {
      var action = $(this).data("entry-action");
      var entryId = $(this).data("entry-id");

      event.preventDefault();
      event.stopPropagation();

      if (!action || !entryId || state.busy || state.quarantine.loading) {
        return;
      }

      startQuarantineManagerActionFlow(action, [entryId]);
    });
  }

  function handleBadgeFilterClick(event) {
    var $badge = $(this);
    var kind = $.trim(String($badge.data("badgeKind") || ""));
    var value = $.trim(String($badge.data("badgeValue") || ""));
    var label = $.trim(String($badge.data("badgeLabel") || $badge.text() || ""));

    event.preventDefault();
    event.stopPropagation();

    if (!kind || !value) {
      return;
    }

    if (isBadgeFilterActive(kind, value)) {
      state.badgeFilter = null;
    } else {
      state.badgeFilter = {
        kind: kind,
        value: value,
        label: label || value
      };
    }

    renderResults();
    renderResultsMeta();
    updateActionBar();
  }

  function handleBadgeFilterKeydown(event) {
    var key = String(event.key || "");

    if (key !== "Enter" && key !== " ") {
      return;
    }

    event.preventDefault();
    $(this).trigger("click");
  }

  function buildContext() {
    return {
      state: state,
      els: els,
      strings: strings
    };
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
    els.$enableZfsDelete.prop("checked", !!settings.enableZfsDatasetDelete);
  }

  function getPrimaryOperation() {
    return state.settings.enablePermanentDelete ? "delete" : "quarantine";
  }

  function getPrimaryActionLabel() {
    return state.settings.enablePermanentDelete
      ? ACP.t(strings, "deleteActionLabel", "Delete selected")
      : ACP.t(strings, "quarantineActionLabel", "Quarantine selected");
  }

  function isRowLockOverrideAllowed(row) {
    return !!row && !row.ignored && !!row.lockOverrideAllowed;
  }

  function isRowPendingLockOverride(row) {
    return isRowLockOverrideAllowed(row) && !!row.policyLocked && !row.lockOverridden;
  }

  function isRowRelockable(row) {
    return isRowLockOverrideAllowed(row) && !!row.lockOverridden;
  }

  function isRowSelectable(row) {
    return !!row && !row.ignored && (!!row.canDelete || isRowLockOverrideAllowed(row));
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
    els.$enableZfsDelete.prop("disabled", state.busy);
    els.$sort.prop("disabled", state.busy);
    updateActionBar();
  }

  function resetDashboardState() {
    state.rows = [];
    state.summary = { total: 0, deletable: 0, review: 0, blocked: 0, ignored: 0 };
    state.selected = {};
    state.scanToken = "";
    state.dockerRunning = true;
    state.auditHistory = [];
    state.scanWarningMessage = "";
    state.settings = ACP.defaultSafetySettings();
    state.appdataSources = { detected: [], effective: [] };
    state.appdataSourceBrowser = defaultAppdataSourceBrowserState();
    state.zfsPathMappingBrowser = defaultZfsPathMappingBrowserState();
    state.quarantine.entries = [];
    state.quarantine.loaded = false;
    state.quarantine.selected = {};
    state.quarantine.summary = { count: 0, sizeLabel: "0 B" };
    state.quarantine.purgeAtInput = "";
    state.quarantine.restoreConflict = null;
    state.scanHydration.active = false;
    state.scanHydration.queue = [];
    state.scanHydration.requestToken = "";
  }

  function loadScan() {
    var shouldHydrate = false;
    var previousBrowserState = $.extend(true, {}, state.appdataSourceBrowser || defaultAppdataSourceBrowserState());
    var previousZfsBrowserState = $.extend(true, {}, state.zfsPathMappingBrowser || defaultZfsPathMappingBrowserState());

    stopScanStatHydration();
    setBusy(true);
    renderLoadingState();
    if (isAppdataSourcesModalVisible()) {
      renderAppdataSourcesModal();
    }
    if (isZfsPathMappingsModalVisible()) {
      renderZfsPathMappingsModal();
    }

    apiPost({
      action: "getOrphanAppdata"
    }).done(function(response) {
      state.rows = $.isArray(response.rows) ? response.rows : [];
      state.summary = response.summary || { total: 0, deletable: 0, review: 0, blocked: 0, ignored: 0 };
      state.scanToken = String(response.scanToken || "");
      state.dockerRunning = response.dockerRunning !== false;
      state.auditHistory = $.isArray(response.auditHistory) ? response.auditHistory : [];
      state.scanWarningMessage = String(response.scanWarningMessage || "");
      state.settings = $.extend({}, ACP.defaultSafetySettings(), response.settings || {});
      setAppdataSourceInfo(response.appdataSourceInfo || {});
      state.appdataSourceBrowser.manual = normalizeManualAppdataSourcesInput((state.settings || {}).manualAppdataSources || []);
      syncZfsPathMappingBrowserFromSettings();
      state.quarantine.summary = $.extend({ count: 0, sizeLabel: "0 B" }, response.quarantineSummary || {});
      syncQuarantinePurgeInputDefaults(true);
      syncSafetyControls();
      applyLocalSafetyState();
      reconcileSelection();
      shouldHydrate = hasPendingRowStats();
      renderAll();
      if (isAppdataSourcesModalVisible()) {
        renderAppdataSourcesModal();
      }
      if (isZfsPathMappingsModalVisible()) {
        renderZfsPathMappingsModal();
      }
    }).fail(function(xhr) {
      resetDashboardState();
      state.appdataSourceBrowser = previousBrowserState;
      state.zfsPathMappingBrowser = previousZfsBrowserState;
      syncSafetyControls();
      renderSummaryCards();
      renderPanels();
      renderScanSummary();
      renderNotices([]);
      renderResultsMeta();
      renderStateMessage(
        ACP.t(strings, "scanFailedTitle", "Scan failed"),
        ACP.extractErrorMessage(xhr, ACP.t(strings, "scanFailedMessage", "The orphaned appdata scan could not be completed right now.")),
        "rescan",
        ACP.t(strings, "rescanLabel", "Rescan")
      );
      updateActionBar();
      if (isAppdataSourcesModalVisible()) {
        renderAppdataSourcesModal();
      }
      if (isZfsPathMappingsModalVisible()) {
        renderZfsPathMappingsModal();
      }
    }).always(function() {
      setBusy(false);

      if (shouldHydrate) {
        startScanStatHydration();
      }
    });
  }

  function loadQuarantineManager(forceRefresh, onComplete) {
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
      setQuarantineEntries(quarantine.entries, quarantine.summary);
      state.quarantine.loaded = true;
      state.quarantine.loading = false;
      renderPanels();
      if (typeof onComplete === "function") {
        onComplete();
      }
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

  function renderQuarantineManagerModal(loading) {
    if (loading) {
      ACP.applyDeleteModalClass(
        "acp-delete-modal acp-delete-results-modal acp-quarantine-manager-modal",
        '<div class="acp-modal-summary"><div class="acp-modal-copy"><div class="acp-modal-subcopy">' +
        ACP.escapeHtml(ACP.t(strings, "quarantineLoadingMessage", "Reviewing tracked quarantined folders.")) +
        "</div></div></div>"
      );
      return;
    }

    ACP.applyDeleteModalClass(
      "acp-delete-modal acp-delete-results-modal acp-quarantine-manager-modal",
      ACP.buildQuarantineManagerModalHtml(buildContext())
    );
  }

  function renderAuditHistoryModal() {
    ACP.applyDeleteModalClass(
      "acp-delete-modal acp-delete-results-modal acp-audit-history-modal",
      ACP.buildAuditHistoryModalHtml(buildContext())
    );
  }

  function renderToolsModal() {
    ACP.applyDeleteModalClass(
      "acp-delete-modal acp-delete-results-modal acp-tools-modal",
      ACP.buildToolsModalHtml(buildContext())
    );
  }

  function renderAppdataSourcesModal() {
    ACP.applyDeleteModalClass(
      "acp-delete-modal acp-delete-results-modal acp-appdata-sources-modal",
      ACP.buildAppdataSourcesModalHtml(buildContext())
    );
  }

  function renderZfsPathMappingsModal() {
    ACP.applyDeleteModalClass(
      "acp-delete-modal acp-delete-results-modal acp-zfs-path-mappings-modal",
      ACP.buildZfsPathMappingsModalHtml(buildContext())
    );
  }

  function ensureQuarantineManagerModal() {
    if (isQuarantineManagerModalVisible()) {
      return;
    }

    swal({
      title: ACP.t(strings, "quarantineManagerTitle", "Quarantine manager"),
      text: "",
      type: "info",
      html: true,
      showCancelButton: false,
      confirmButtonText: ACP.t(strings, "doneLabel", "Done"),
      closeOnConfirm: true
    }, function() {
      window.setTimeout(function() {
        ACP.releaseModalScrollLock(false);
        renderPanels();
      }, 180);
    });
  }

  function ensureAuditHistoryModal() {
    if (state.auditOpen) {
      return;
    }

    state.auditOpen = true;
    swal({
      title: ACP.t(strings, "auditHistoryTitle", "Audit history"),
      text: "",
      type: "info",
      html: true,
      showCancelButton: false,
      confirmButtonText: ACP.t(strings, "doneLabel", "Done"),
      closeOnConfirm: true
    }, function() {
      state.auditOpen = false;
      window.setTimeout(function() {
        ACP.releaseModalScrollLock(false);
        renderPanels();
      }, 180);
    });
  }

  function ensureToolsModal() {
    if (isToolsModalVisible()) {
      return;
    }

    swal({
      title: ACP.t(strings, "toolsTitle", "Tools"),
      text: "",
      type: "info",
      html: true,
      showCancelButton: false,
      confirmButtonText: ACP.t(strings, "doneLabel", "Done"),
      closeOnConfirm: true
    }, function() {
      window.setTimeout(function() {
        ACP.releaseModalScrollLock(false);
        renderPanels();
      }, 180);
    });
  }

  function ensureAppdataSourcesModal() {
    if (isAppdataSourcesModalVisible()) {
      return;
    }

    swal({
      title: ACP.t(strings, "appdataSourcesTitle", "Appdata sources"),
      text: "",
      type: "info",
      html: true,
      showCancelButton: false,
      confirmButtonText: ACP.t(strings, "doneLabel", "Done"),
      closeOnConfirm: true
    }, function() {
      window.setTimeout(function() {
        ACP.releaseModalScrollLock(false);
        renderPanels();
      }, 180);
    });
  }

  function ensureZfsPathMappingsModal() {
    if (isZfsPathMappingsModalVisible()) {
      return;
    }

    swal({
      title: ACP.t(strings, "zfsPathMappingsTitle", "ZFS path mappings"),
      text: "",
      type: "info",
      html: true,
      showCancelButton: false,
      confirmButtonText: ACP.t(strings, "doneLabel", "Done"),
      closeOnConfirm: true
    }, function() {
      window.setTimeout(function() {
        ACP.releaseModalScrollLock(false);
        renderPanels();
      }, 180);
    });
  }

  function openQuarantineManagerModal(forceRefresh) {
    if (state.busy) {
      return;
    }

    if (!forceRefresh && state.quarantine.loaded) {
      ensureQuarantineManagerModal();
      renderQuarantineManagerModal(false);
      return;
    }

    ensureQuarantineManagerModal();
    renderPanels();
    renderQuarantineManagerModal(true);
    loadQuarantineManager(true, function() {
      renderQuarantineManagerModal(false);
    });
  }

  function openAuditHistoryModal() {
    if (state.busy) {
      return;
    }

    ensureAuditHistoryModal();
    renderPanels();
    renderAuditHistoryModal();
  }

  function openToolsModal() {
    if (state.busy) {
      return;
    }

    ensureToolsModal();
    renderPanels();
    renderToolsModal();
  }

  function isToolsModalVisible() {
    return getActiveSweetAlertModal().hasClass("acp-tools-modal");
  }

  function openRowDetailsModal(row) {
    if (!row) {
      return;
    }

    swal({
      title: ACP.t(strings, "rowDetailsTitle", "Row details"),
      text: "",
      type: "info",
      html: true,
      showCancelButton: false,
      confirmButtonText: ACP.t(strings, "doneLabel", "Done"),
      closeOnConfirm: true
    }, function() {
      window.setTimeout(function() {
        ACP.releaseModalScrollLock(false);
        renderPanels();
      }, 180);
    });

    ACP.applyDeleteModalClass(
      "acp-delete-modal acp-delete-results-modal acp-row-details-modal",
      ACP.buildRowDetailsModalHtml(buildContext(), row)
    );
  }

  function openAppdataSourcesModal() {
    syncAppdataSourceBrowserManualSourcesFromSettings();
    state.appdataSourceBrowser.feedbackMessage = "";
    ensureAppdataSourcesModal();
    renderPanels();
    renderAppdataSourcesModal();
    loadAppdataSourceBrowser(state.appdataSourceBrowser.currentPath || state.appdataSourceBrowser.root || "/mnt", {
      preserveFeedback: true
    });
  }

  function isAppdataSourcesModalVisible() {
    return getActiveSweetAlertModal().hasClass("acp-appdata-sources-modal");
  }

  function openZfsPathMappingsModal() {
    if (!state.settings.enableZfsDatasetDelete) {
      swal(
        ACP.t(strings, "zfsPathMappingsUnavailableTitle", "Enable ZFS dataset delete first"),
        ACP.t(strings, "zfsPathMappingsUnavailableMessage", "Turn on ZFS dataset delete in Safety settings before configuring ZFS mappings."),
        "warning"
      );
      return;
    }

    syncZfsPathMappingBrowserFromSettings();
    state.zfsPathMappingBrowser.feedbackMessage = "";
    ensureZfsPathMappingsModal();
    renderPanels();
    renderZfsPathMappingsModal();
    loadZfsPathMappingBrowser(state.zfsPathMappingBrowser.currentPath || state.zfsPathMappingBrowser.root || "/mnt", {
      preserveFeedback: true
    });
  }

  function isZfsPathMappingsModalVisible() {
    return getActiveSweetAlertModal().hasClass("acp-zfs-path-mappings-modal");
  }

  function findRowById(rowId) {
    var targetId = String(rowId || "");
    var match = null;

    $.each(state.rows || [], function(_, row) {
      if (String((row && row.id) || "") === targetId) {
        match = row;
        return false;
      }

      return undefined;
    });

    return match;
  }

  function setAppdataSourceInfo(info) {
    var nextInfo = $.isPlainObject(info) ? info : {};

    state.appdataSources = {
      detected: $.isArray(nextInfo.detected) ? nextInfo.detected : [],
      manual: $.isArray(nextInfo.manual) ? nextInfo.manual : [],
      effective: $.isArray(nextInfo.effective) ? nextInfo.effective : [],
      zfsPathMappings: $.isArray(nextInfo.zfsPathMappings) ? nextInfo.zfsPathMappings : []
    };
  }

  function setAppdataSourceBrowserPayload(payload) {
    var nextPayload = $.isPlainObject(payload) ? payload : {};
    var nextState = $.extend({}, defaultAppdataSourceBrowserState(), state.appdataSourceBrowser || {});

    nextState.root = String(nextPayload.root || nextState.root || "/mnt");
    nextState.currentPath = String(nextPayload.currentPath || nextState.currentPath || nextState.root);
    nextState.parentPath = String(nextPayload.parentPath || "");
    nextState.breadcrumbs = $.isArray(nextPayload.breadcrumbs) ? nextPayload.breadcrumbs : [];
    nextState.entries = $.isArray(nextPayload.entries) ? nextPayload.entries : [];
    nextState.canAdd = !!nextPayload.canAdd;
    nextState.validationMessage = String(nextPayload.validationMessage || "");
    nextState.loaded = true;
    nextState.loading = false;
    state.appdataSourceBrowser = nextState;
  }

  function setAppdataSourcesFeedback(message) {
    var $feedback = $(".sweet-alert [data-role='appdata-sources-feedback']");
    var nextMessage = String(message || "");

    state.appdataSourceBrowser.feedbackMessage = nextMessage;

    if (!$feedback.length) {
      return;
    }

    $feedback.text(nextMessage);
  }

  function setZfsPathMappingsFeedback(message) {
    var $feedback = $(".sweet-alert [data-role='zfs-path-mappings-feedback']");
    var nextMessage = String(message || "");

    state.zfsPathMappingBrowser.feedbackMessage = nextMessage;

    if (!$feedback.length) {
      return;
    }

    $feedback.text(nextMessage);
  }

  function normalizeManualAppdataSourcesInput(rawValue) {
    var seen = {};
    var sourceValues = $.isArray(rawValue) ? rawValue : String(rawValue || "").split(/\r?\n/);

    return $.grep($.map(sourceValues, function(line) {
      var trimmed = $.trim(String(line || ""));

      if (!trimmed || seen[trimmed]) {
        return null;
      }

      seen[trimmed] = true;
      return trimmed;
    }), function(value) {
      return !!value;
    });
  }

  function normalizeZfsPathMapping(path) {
    var normalized = $.trim(String(path || "")).replace(/\\/g, "/").replace(/\/+/g, "/");

    if (normalized.length > 1) {
      normalized = normalized.replace(/\/$/, "");
    }

    return normalized;
  }

  function normalizeZfsPathMappingsInput(rawValue) {
    var mappingValues = $.isArray(rawValue) ? rawValue : [];
    var seen = {};

    return $.grep($.map(mappingValues, function(mapping) {
      var shareRoot = normalizeZfsPathMapping(mapping && mapping.shareRoot);
      var datasetRoot = normalizeZfsPathMapping(mapping && mapping.datasetRoot);
      var mappingKey = shareRoot + "=>" + datasetRoot;

      if (!shareRoot || !datasetRoot || shareRoot === datasetRoot || seen[mappingKey]) {
        return null;
      }

      seen[mappingKey] = true;
      return {
        shareRoot: shareRoot,
        datasetRoot: datasetRoot
      };
    }), function(mapping) {
      return !!mapping;
    });
  }

  function syncAppdataSourceBrowserManualSourcesFromSettings() {
    var nextBrowserState = $.extend({}, defaultAppdataSourceBrowserState(), state.appdataSourceBrowser || {});

    nextBrowserState.manual = normalizeManualAppdataSourcesInput((state.settings || {}).manualAppdataSources || []);
    state.appdataSourceBrowser = nextBrowserState;
  }

  function getManualAppdataSourcesFromModal() {
    return normalizeManualAppdataSourcesInput((state.appdataSourceBrowser || {}).manual || []);
  }

  function getZfsPathMappingsFromModal() {
    return normalizeZfsPathMappingsInput((state.zfsPathMappingBrowser || {}).mappings || []);
  }

  function getSavedZfsPathMappings() {
    return normalizeZfsPathMappingsInput((state.settings || {}).zfsPathMappings || []);
  }

  function getZfsPathMappingDraftState(mappings) {
    var activeMappings = normalizeZfsPathMappingsInput($.isArray(mappings) ? mappings : getZfsPathMappingsFromModal());
    var draft = $.isPlainObject(state.zfsPathMappingBrowser.draft) ? state.zfsPathMappingBrowser.draft : {};
    var shareRoot = normalizeZfsPathMapping(draft.shareRoot || "");
    var datasetRoot = normalizeZfsPathMapping(draft.datasetRoot || "");
    var mappingKey = shareRoot + "=>" + datasetRoot;
    var isComplete = !!shareRoot && !!datasetRoot && shareRoot !== datasetRoot;
    var isPartial = (!!shareRoot || !!datasetRoot) && !isComplete;
    var isDuplicate = false;

    $.each(activeMappings, function(_, mapping) {
      var nextKey = String((mapping && mapping.shareRoot) || "") + "=>" + String((mapping && mapping.datasetRoot) || "");

      if (nextKey === mappingKey) {
        isDuplicate = true;
        return false;
      }

      return undefined;
    });

    return {
      shareRoot: shareRoot,
      datasetRoot: datasetRoot,
      mappingKey: mappingKey,
      isEmpty: !shareRoot && !datasetRoot,
      isComplete: isComplete,
      isPartial: isPartial,
      isDuplicate: isDuplicate,
      isPending: isComplete && !isDuplicate
    };
  }

  function getPreparedZfsPathMappingsForSave() {
    var baseMappings = getZfsPathMappingsFromModal();
    var savedMappings = getSavedZfsPathMappings();
    var draftState = getZfsPathMappingDraftState(baseMappings);
    var nextMappings = baseMappings.slice(0);

    if (draftState.isPartial) {
      return {
        ok: false,
        message: ACP.t(strings, "zfsPathMappingsDraftPartialMessage", "Finish both roots before saving. ZFS mappings only affect dataset delete resolution, not scan discovery.")
      };
    }

    if (draftState.isPending) {
      nextMappings.push({
        shareRoot: draftState.shareRoot,
        datasetRoot: draftState.datasetRoot
      });
      nextMappings = normalizeZfsPathMappingsInput(nextMappings);
    }

    return {
      ok: true,
      mappings: nextMappings,
      autoAddedDraft: draftState.isPending,
      changed: JSON.stringify(nextMappings) !== JSON.stringify(savedMappings)
    };
  }

  function syncZfsPathMappingBrowserFromSettings() {
    var nextBrowserState = $.extend(true, {}, defaultZfsPathMappingBrowserState(), state.zfsPathMappingBrowser || {});

    nextBrowserState.mappings = normalizeZfsPathMappingsInput((state.settings || {}).zfsPathMappings || []);
    state.zfsPathMappingBrowser = nextBrowserState;
  }

  function loadAppdataSourceBrowser(path, options) {
    var normalizedOptions = $.isPlainObject(options) ? options : {};
    var requestedPath = $.trim(String(path || state.appdataSourceBrowser.currentPath || state.appdataSourceBrowser.root || "/mnt"));
    var requestToken = requestedPath + ":" + String(Date.now());

    state.appdataSourceBrowser.root = String(state.appdataSourceBrowser.root || "/mnt");
    state.appdataSourceBrowser.currentPath = requestedPath || state.appdataSourceBrowser.root;
    state.appdataSourceBrowser.loading = true;
    state.appdataSourceBrowser.requestToken = requestToken;

    if (!normalizedOptions.preserveFeedback) {
      setAppdataSourcesFeedback("");
    }

    if (isAppdataSourcesModalVisible()) {
      renderAppdataSourcesModal();
    }

    apiPost({
      action: "browseAppdataSourcePath",
      path: requestedPath
    }).done(function(response) {
      if (requestToken !== String(state.appdataSourceBrowser.requestToken || "")) {
        return;
      }

      setAppdataSourceBrowserPayload((response && response.browser) || {});
      state.appdataSourceBrowser.requestToken = "";

      if (isAppdataSourcesModalVisible()) {
        renderAppdataSourcesModal();
      }
    }).fail(function(xhr) {
      if (requestToken !== String(state.appdataSourceBrowser.requestToken || "")) {
        return;
      }

      state.appdataSourceBrowser.loading = false;
      state.appdataSourceBrowser.requestToken = "";
      setAppdataSourcesFeedback(ACP.extractErrorMessage(xhr, ACP.t(strings, "appdataSourcesBrowseFailedMessage", "The selected folder could not be browsed right now.")));

      if (isAppdataSourcesModalVisible()) {
        renderAppdataSourcesModal();
      }
    });
  }

  function setZfsPathMappingBrowserPayload(payload) {
    var nextPayload = $.isPlainObject(payload) ? payload : {};
    var nextState = $.extend(true, {}, defaultZfsPathMappingBrowserState(), state.zfsPathMappingBrowser || {});

    nextState.root = String(nextPayload.root || nextState.root || "/mnt");
    nextState.currentPath = String(nextPayload.currentPath || nextState.currentPath || nextState.root);
    nextState.parentPath = String(nextPayload.parentPath || "");
    nextState.breadcrumbs = $.isArray(nextPayload.breadcrumbs) ? nextPayload.breadcrumbs : [];
    nextState.entries = $.isArray(nextPayload.entries) ? nextPayload.entries : [];
    nextState.loaded = true;
    nextState.loading = false;
    state.zfsPathMappingBrowser = nextState;
  }

  function loadZfsPathMappingBrowser(path, options) {
    var normalizedOptions = $.isPlainObject(options) ? options : {};
    var requestedPath = $.trim(String(path || state.zfsPathMappingBrowser.currentPath || state.zfsPathMappingBrowser.root || "/mnt"));
    var requestToken = requestedPath + ":" + String(Date.now());

    state.zfsPathMappingBrowser.root = String(state.zfsPathMappingBrowser.root || "/mnt");
    state.zfsPathMappingBrowser.currentPath = requestedPath || state.zfsPathMappingBrowser.root;
    state.zfsPathMappingBrowser.loading = true;
    state.zfsPathMappingBrowser.requestToken = requestToken;

    if (!normalizedOptions.preserveFeedback) {
      setZfsPathMappingsFeedback("");
    }

    if (isZfsPathMappingsModalVisible()) {
      renderZfsPathMappingsModal();
    }

    apiPost({
      action: "browseAppdataSourcePath",
      path: requestedPath
    }).done(function(response) {
      if (requestToken !== String(state.zfsPathMappingBrowser.requestToken || "")) {
        return;
      }

      setZfsPathMappingBrowserPayload((response && response.browser) || {});
      state.zfsPathMappingBrowser.requestToken = "";

      if (isZfsPathMappingsModalVisible()) {
        renderZfsPathMappingsModal();
      }
    }).fail(function(xhr) {
      if (requestToken !== String(state.zfsPathMappingBrowser.requestToken || "")) {
        return;
      }

      state.zfsPathMappingBrowser.loading = false;
      state.zfsPathMappingBrowser.requestToken = "";
      setZfsPathMappingsFeedback(ACP.extractErrorMessage(xhr, ACP.t(strings, "appdataSourcesBrowseFailedMessage", "The selected folder could not be browsed right now.")));

      if (isZfsPathMappingsModalVisible()) {
        renderZfsPathMappingsModal();
      }
    });
  }

  function setCurrentZfsPathMappingField(field) {
    state.zfsPathMappingBrowser.activeField = String(field || "") === "datasetRoot" ? "datasetRoot" : "shareRoot";
    renderZfsPathMappingsModal();
  }

  function assignCurrentZfsPathMappingBrowserPath() {
    var field = String((state.zfsPathMappingBrowser || {}).activeField || "shareRoot") === "datasetRoot" ? "datasetRoot" : "shareRoot";
    var currentPath = normalizeZfsPathMapping((state.zfsPathMappingBrowser || {}).currentPath || "");

    if (!currentPath) {
      return;
    }

    state.zfsPathMappingBrowser.draft[field] = currentPath;
    setZfsPathMappingsFeedback("");
    renderZfsPathMappingsModal();
  }

  function clearZfsPathMappingDraft() {
    state.zfsPathMappingBrowser.draft = {
      shareRoot: "",
      datasetRoot: ""
    };
    setZfsPathMappingsFeedback("");
    renderZfsPathMappingsModal();
  }

  function addZfsPathMappingFromDraft() {
    var draft = $.isPlainObject(state.zfsPathMappingBrowser.draft) ? state.zfsPathMappingBrowser.draft : {};
    var shareRoot = normalizeZfsPathMapping(draft.shareRoot || "");
    var datasetRoot = normalizeZfsPathMapping(draft.datasetRoot || "");
    var nextMappings = getZfsPathMappingsFromModal();
    var mappingKey = shareRoot + "=>" + datasetRoot;
    var isDuplicate = false;

    if (!shareRoot || !datasetRoot || shareRoot === datasetRoot) {
      setZfsPathMappingsFeedback(ACP.t(strings, "zfsPathMappingsDraftIncompleteMessage", "Choose both an Unraid share root and a ZFS dataset mount root before adding the mapping."));
      renderZfsPathMappingsModal();
      return;
    }

    $.each(nextMappings, function(_, mapping) {
      var nextKey = String((mapping && mapping.shareRoot) || "") + "=>" + String((mapping && mapping.datasetRoot) || "");

      if (nextKey === mappingKey) {
        isDuplicate = true;
        return false;
      }

      return undefined;
    });

    if (isDuplicate) {
      setZfsPathMappingsFeedback(ACP.t(strings, "zfsPathMappingsDuplicateMessage", "This ZFS path mapping is already configured."));
      renderZfsPathMappingsModal();
      return;
    }

    nextMappings.push({
      shareRoot: shareRoot,
      datasetRoot: datasetRoot
    });
    state.zfsPathMappingBrowser.mappings = normalizeZfsPathMappingsInput(nextMappings);
    state.zfsPathMappingBrowser.draft = {
      shareRoot: "",
      datasetRoot: ""
    };
    state.zfsPathMappingBrowser.activeField = "shareRoot";
    setZfsPathMappingsFeedback("");
    renderZfsPathMappingsModal();
  }

  function removeZfsPathMappingFromBrowser(shareRoot, datasetRoot) {
    var targetShareRoot = normalizeZfsPathMapping(shareRoot || "");
    var targetDatasetRoot = normalizeZfsPathMapping(datasetRoot || "");

    state.zfsPathMappingBrowser.mappings = $.grep(getZfsPathMappingsFromModal(), function(mapping) {
      return String((mapping && mapping.shareRoot) || "") !== targetShareRoot
        || String((mapping && mapping.datasetRoot) || "") !== targetDatasetRoot;
    });
    setZfsPathMappingsFeedback("");
    renderZfsPathMappingsModal();
  }

  function addCurrentAppdataSourceFromBrowser() {
    var currentPath = $.trim(String(state.appdataSourceBrowser.currentPath || ""));
    var nextManualSources = getManualAppdataSourcesFromModal();

    if (!currentPath) {
      return;
    }

    if ($.inArray(currentPath, nextManualSources) !== -1) {
      setAppdataSourcesFeedback(ACP.t(strings, "appdataSourcesAlreadyAddedMessage", "This path is already in the manual source list."));
      renderAppdataSourcesModal();
      return;
    }

    if (!state.appdataSourceBrowser.canAdd) {
      setAppdataSourcesFeedback(state.appdataSourceBrowser.validationMessage || ACP.t(strings, "appdataSourcesInvalidCurrentMessage", "This path cannot be added as a manual appdata source yet."));
      renderAppdataSourcesModal();
      return;
    }

    nextManualSources.push(currentPath);
    state.appdataSourceBrowser.manual = normalizeManualAppdataSourcesInput(nextManualSources);
    setAppdataSourcesFeedback("");
    renderAppdataSourcesModal();
  }

  function removeManualAppdataSourceFromBrowser(path) {
    var targetPath = $.trim(String(path || ""));

    if (!targetPath) {
      return;
    }

    state.appdataSourceBrowser.manual = $.grep(getManualAppdataSourcesFromModal(), function(sourcePath) {
      return String(sourcePath || "") !== targetPath;
    });
    setAppdataSourcesFeedback("");
    renderAppdataSourcesModal();
  }

  function saveAppdataSourcesFromModal() {
    setAppdataSourcesFeedback(ACP.t(strings, "appdataSourcesSavingMessage", "Saving appdata sources and rescanning."));
    saveSafetySettings({
      manualAppdataSources: getManualAppdataSourcesFromModal()
    }, {
      reloadScanOnSuccess: true,
      skipRenderAll: true,
      failureTitle: ACP.t(strings, "appdataSourcesSaveFailedTitle", "Appdata sources failed"),
      failureMessage: ACP.t(strings, "appdataSourcesSaveFailedMessage", "The appdata source list could not be saved right now."),
      onSuccess: function() {
        setAppdataSourcesFeedback(ACP.t(strings, "appdataSourcesSavingMessage", "Saving appdata sources and rescanning."));
      },
      onFailure: function(xhr) {
        setAppdataSourcesFeedback(ACP.extractErrorMessage(xhr, ACP.t(strings, "appdataSourcesSaveFailedMessage", "The appdata source list could not be saved right now.")));
      }
    });
  }

  function saveZfsPathMappingsFromModal() {
    var prepared = getPreparedZfsPathMappingsForSave();

    if (!prepared.ok) {
      setZfsPathMappingsFeedback(prepared.message || ACP.t(strings, "zfsPathMappingsSaveFailedMessage", "The ZFS path mappings could not be saved right now."));
      renderZfsPathMappingsModal();
      return;
    }

    if (!prepared.changed) {
      setZfsPathMappingsFeedback(ACP.t(strings, "zfsPathMappingsNoChangesMessage", "No ZFS mapping changes are waiting to be saved."));
      renderZfsPathMappingsModal();
      return;
    }

    setZfsPathMappingsFeedback(
      prepared.autoAddedDraft
        ? ACP.t(strings, "zfsPathMappingsSavingWithDraftMessage", "Saving ZFS path mappings, including the current draft, and rescanning.")
        : ACP.t(strings, "zfsPathMappingsSavingMessage", "Saving ZFS path mappings and rescanning.")
    );
    saveSafetySettings({
      zfsPathMappings: prepared.mappings
    }, {
      reloadScanOnSuccess: true,
      skipRenderAll: true,
      failureTitle: ACP.t(strings, "zfsPathMappingsSaveFailedTitle", "ZFS path mappings failed"),
      failureMessage: ACP.t(strings, "zfsPathMappingsSaveFailedMessage", "The ZFS path mappings could not be saved right now."),
      onSuccess: function(response) {
        var savedMappings = normalizeZfsPathMappingsInput((response && response.settings && response.settings.zfsPathMappings) || prepared.mappings);
        var mappingCount = savedMappings.length;

        state.zfsPathMappingBrowser.draft = {
          shareRoot: "",
          datasetRoot: ""
        };
        state.zfsPathMappingBrowser.activeField = "shareRoot";
        setZfsPathMappingsFeedback(
          mappingCount === 1
            ? ACP.t(strings, "zfsPathMappingsSavedSingleMessage", "Saved 1 ZFS mapping and rescanning.")
            : ACP.t(strings, "zfsPathMappingsSavedManyMessage", "Saved {count} ZFS mappings and rescanning.").replace("{count}", String(mappingCount))
        );
      },
      onFailure: function(xhr) {
        setZfsPathMappingsFeedback(ACP.extractErrorMessage(xhr, ACP.t(strings, "zfsPathMappingsSaveFailedMessage", "The ZFS path mappings could not be saved right now.")));
      }
    });
  }

  function applyLocalSafetyStateToRow(row) {
    var nextRow = $.extend({}, row);

    nextRow.policyLocked = false;
    nextRow.policyReason = "";
    nextRow.lockOverrideAllowed = !!nextRow.lockOverrideAllowed;
    nextRow.lockOverridden = nextRow.lockOverrideAllowed && !!nextRow.lockOverridden;

    if (nextRow.ignored) {
      nextRow.lockOverrideAllowed = false;
      nextRow.lockOverridden = false;
      nextRow.canDelete = false;
      return nextRow;
    }

    if (nextRow.securityLockReason) {
      nextRow.canDelete = false;
      nextRow.policyLocked = true;
      nextRow.policyReason = nextRow.securityLockReason;
      nextRow.lockOverrideAllowed = false;
      nextRow.lockOverridden = false;
      return nextRow;
    }

    if (nextRow.storageKind === "zfs") {
      nextRow.lockOverrideAllowed = false;
      nextRow.lockOverridden = false;

      if (!state.settings.enableZfsDatasetDelete) {
        nextRow.canDelete = false;
        nextRow.policyLocked = true;
        nextRow.policyReason = "ZFS dataset delete is disabled in Safety settings.";
        return nextRow;
      }

      if (!state.settings.enablePermanentDelete) {
        nextRow.canDelete = false;
        nextRow.policyLocked = true;
        nextRow.policyReason = ACP.t(strings, "selectionHintZfsMode", "ZFS dataset-backed rows require permanent delete mode and cannot be quarantined.");
        return nextRow;
      }
    }

    if (nextRow.risk === "blocked") {
      nextRow.lockOverrideAllowed = false;
      nextRow.lockOverridden = false;
      nextRow.canDelete = false;
      return nextRow;
    }

    if (nextRow.risk === "review" && !state.settings.allowOutsideShareCleanup) {
      nextRow.lockOverrideAllowed = true;

      if (!nextRow.lockOverridden) {
        nextRow.canDelete = false;
        nextRow.policyLocked = true;
        nextRow.policyReason = "Outside-share cleanup is disabled in Safety settings.";
        return nextRow;
      }

      nextRow.canDelete = true;
      return nextRow;
    }

    nextRow.lockOverrideAllowed = false;
    nextRow.lockOverridden = false;
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

  function buildScanInsights() {
    var rows = $.isArray(state.rows) ? state.rows : [];
    var effectiveRoots = (state.appdataSources && $.isArray(state.appdataSources.effective)) ? state.appdataSources.effective : [];
    var summary = state.summary || {};
    var templateRows = 0;
    var discoveryRows = 0;
    var zfsRows = 0;
    var mappedRows = 0;

    $.each(rows, function(_, row) {
      if (!row || row.ignored) {
        return;
      }

      if (String(row.sourceKind || "template") === "filesystem") {
        discoveryRows += 1;
      } else {
        templateRows += 1;
      }

      if (String(row.storageKind || "") === "zfs") {
        zfsRows += 1;
      } else if (row.zfsMappingMatched) {
        mappedRows += 1;
      }
    });

    return {
      scanRoots: effectiveRoots.slice(0),
      scanRootCount: effectiveRoots.length,
      templateRowCount: templateRows,
      discoveryRowCount: discoveryRows,
      reviewCount: Number(summary.review || 0),
      lockedCount: Number(summary.blocked || 0),
      zfsBackedCount: zfsRows,
      mappedShareCount: mappedRows,
      ignoredCount: Number(summary.ignored || 0)
    };
  }

  function buildLocalNotices() {
    var notices = [];
    var summary = state.summary || { total: 0, review: 0, blocked: 0, ignored: 0 };
    var hasZfsRows = $.grep(state.rows || [], function(row) {
      return row && row.storageKind === "zfs";
    }).length > 0;

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

    if (state.scanWarningMessage) {
      notices.push({
        type: "warning",
        title: ACP.t(strings, "scanReadOnlyTitle", "Read-only scan"),
        message: state.scanWarningMessage || ACP.t(strings, "scanReadOnlyMessage", "Scan results loaded, but actions are disabled because a secure snapshot could not be created right now.")
      });
    }

    if (Number(summary.review || 0) > 0) {
      if (!state.settings.allowOutsideShareCleanup) {
        notices.push({
          type: "info",
          title: ACP.t(strings, "noticeOutsideShareDisabledTitle", "Outside-share cleanup is disabled"),
          message: ACP.t(strings, "noticeOutsideShareDisabledMessage", "Review paths stay visible and start locked. Select them and use Unlock selected to allow them for this scan.")
        });
      } else {
        notices.push({
          type: "warning",
          title: ACP.t(strings, "noticeOutsideShareEnabledTitle", "Outside-share cleanup is enabled"),
          message: ACP.t(strings, "noticeOutsideShareEnabledMessage", "Review paths sit outside the configured appdata sources. Confirm each one carefully before acting.")
        });
      }
    }

    if (Number(summary.blocked || 0) > 0) {
      notices.push({
        type: "warning",
        title: ACP.t(strings, "noticeLockedPathsTitle", "Locked paths stay blocked"),
        message: ACP.t(strings, "noticeLockedPathsMessage", "Any path that resolves to a share root, mount point, symlinked location, or other unsafe target cannot be unlocked or acted on here.")
      });
    }

    if (hasZfsRows) {
      notices.push({
        type: state.settings.enableZfsDatasetDelete ? "info" : "warning",
        title: state.settings.enableZfsDatasetDelete
          ? ACP.t(strings, "noticeZfsDatasetTitle", "ZFS dataset candidates found")
          : ACP.t(strings, "noticeZfsDeleteDisabledTitle", "ZFS dataset delete is disabled"),
        message: state.settings.enableZfsDatasetDelete
          ? (
            state.settings.enablePermanentDelete
              ? ACP.t(strings, "noticeZfsDatasetMessage", "ZFS-backed appdata rows use dataset destroy instead of folder delete. Quarantine is not available for those rows.")
              : ACP.t(strings, "noticeZfsDatasetDeleteModeMessage", "ZFS-backed appdata rows use dataset destroy instead of folder delete. Quarantine is not available for those rows, so permanent delete mode must also be enabled before they become actionable.")
          )
          : ACP.t(strings, "noticeZfsDeleteDisabledMessage", "ZFS-backed rows stay visible but blocked until ZFS dataset delete is enabled in Safety settings. Enabling it also reveals the ZFS mappings action so share roots can be mapped to dataset mount roots.")
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

  function hasPendingRowStats() {
    return $.grep(state.rows || [], function(row) {
      return !!row.statsPending;
    }).length > 0;
  }

  function getPendingRowStatIds() {
    return $.map(state.rows || [], function(row) {
      return row && row.statsPending && row.id ? row.id : null;
    });
  }

  function clearPendingRowStats(rowIds) {
    var idsByKey = {};

    $.each($.isArray(rowIds) ? rowIds : [rowIds], function(_, rowId) {
      var rowKey = String(rowId || "");
      if (rowKey) {
        idsByKey[rowKey] = true;
      }
    });

    state.rows = $.map(state.rows || [], function(row) {
      if (!row || !idsByKey[String(row.id || "")]) {
        return row;
      }

      return $.extend({}, row, {
        statsPending: false
      });
    });
  }

  function applyHydratedCandidateStats(rows) {
    var statsById = {};

    $.each($.isArray(rows) ? rows : [], function(_, row) {
      var rowId = String((row && row.id) || "");
      if (rowId) {
        statsById[rowId] = row;
      }
    });

    state.rows = $.map(state.rows || [], function(row) {
      var nextStats = statsById[String((row && row.id) || "")];

      if (!nextStats) {
        return row;
      }

      return $.extend({}, row, nextStats, {
        statsPending: false
      });
    });
  }

  function stopScanStatHydration() {
    state.scanHydration.active = false;
    state.scanHydration.queue = [];
    state.scanHydration.requestToken = "";
  }

  function requestNextScanStatBatch(requestToken) {
    var batchIds;

    if (!state.scanHydration.active || state.scanHydration.requestToken !== requestToken || !state.scanToken) {
      return;
    }

    if (!state.scanHydration.queue.length) {
      stopScanStatHydration();
      return;
    }

    batchIds = state.scanHydration.queue.splice(0, state.scanHydration.batchSize);

    apiPost({
      action: "hydrateCandidateStats",
      scanToken: state.scanToken,
      candidateIds: JSON.stringify(batchIds)
    }).done(function(response) {
      if (!state.scanHydration.active || state.scanHydration.requestToken !== requestToken) {
        return;
      }

      applyHydratedCandidateStats(response.rows);
      renderResults();

      if (!state.scanHydration.queue.length) {
        stopScanStatHydration();
        return;
      }

      window.setTimeout(function() {
        requestNextScanStatBatch(requestToken);
      }, 0);
    }).fail(function() {
      if (!state.scanHydration.active || state.scanHydration.requestToken !== requestToken) {
        return;
      }

      clearPendingRowStats(batchIds.concat(state.scanHydration.queue));
      stopScanStatHydration();
      renderResults();
    });
  }

  function startScanStatHydration() {
    var pendingRowIds = getPendingRowStatIds();
    var requestToken;

    if (!state.scanToken || !pendingRowIds.length) {
      stopScanStatHydration();
      return;
    }

    requestToken = String(state.scanToken) + ":" + String(Date.now());
    state.scanHydration.active = true;
    state.scanHydration.queue = pendingRowIds;
    state.scanHydration.requestToken = requestToken;
    requestNextScanStatBatch(requestToken);
  }

  function reconcileSelection() {
    var allowed = {};

    $.each(state.rows, function(_, row) {
      if (isRowSelectable(row)) {
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
  }

  function renderAll() {
    renderSummaryCards();
    renderPanels();
    renderScanSummary();
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
      var glowClass = Number(card.value || 0) > 0 ? " has-glow" : "";
      html.push(
        '<article class="acp-summary-card ' + card.tone + glowClass + '">' +
          '<span class="acp-summary-label">' + ACP.escapeHtml(card.label) + "</span>" +
          '<span class="acp-summary-value">' + ACP.escapeHtml(String(card.value)) + "</span>" +
        "</article>"
      );
    });

    els.$summaryCards.html(html.join(""));
  }

  function renderScanSummary() {
    var insights = buildScanInsights();
    var cards = [
      { label: ACP.t(strings, "scanSummaryRootsLabel", "Scan roots"), value: insights.scanRootCount, tone: "" },
      { label: ACP.t(strings, "scanSummaryTemplateLabel", "Template rows"), value: insights.templateRowCount, tone: "" },
      { label: ACP.t(strings, "scanSummaryDiscoveryLabel", "Discovery rows"), value: insights.discoveryRowCount, tone: "is-scheduled" },
      { label: ACP.t(strings, "scanSummaryReviewLabel", "Outside-share review"), value: insights.reviewCount, tone: "is-review" },
      { label: ACP.t(strings, "scanSummaryLockedLabel", "Hard locked"), value: insights.lockedCount, tone: "is-blocked" },
      { label: ACP.t(strings, "scanSummaryZfsLabel", "ZFS-backed"), value: insights.zfsBackedCount, tone: "is-selected" },
      { label: ACP.t(strings, "scanSummaryMappedLabel", "Mapped share path"), value: insights.mappedShareCount, tone: "is-scheduled" },
      { label: ACP.t(strings, "scanSummaryIgnoredLabel", "Ignored"), value: insights.ignoredCount, tone: "" }
    ];
    var cardHtml = [];
    var rootsHtml = [];

    if (!els.$scanSummary || !els.$scanSummary.length) {
      return;
    }

    if (!state.rows.length && !insights.scanRootCount) {
      els.$scanSummary.empty();
      return;
    }

    $.each(cards, function(_, card) {
      cardHtml.push(
        '<span class="acp-modal-stat ' + ACP.escapeHtml(card.tone || "") + '">' +
          ACP.escapeHtml(card.label) + ": " + ACP.escapeHtml(String(card.value || 0)) +
        "</span>"
      );
    });

    if (insights.scanRoots.length) {
      $.each(insights.scanRoots, function(_, path) {
        rootsHtml.push('<code class="acp-modal-path">' + ACP.escapeHtml(String(path || "")) + "</code>");
      });
    } else {
      rootsHtml.push('<div class="acp-utility-empty">' + ACP.escapeHtml(ACP.t(strings, "scanSummaryRootsEmpty", "No scan roots are configured yet.")) + "</div>");
    }

    els.$scanSummary.html(
      '<article class="acp-scan-summary-panel">' +
        '<div class="acp-scan-summary-head">' +
          '<div class="acp-utility-copy">' +
            '<div class="acp-utility-title">' + ACP.escapeHtml(ACP.t(strings, "scanSummaryTitle", "Scan summary")) + "</div>" +
            '<div class="acp-utility-subtitle">' + ACP.escapeHtml(ACP.t(strings, "scanSummarySubtitle", "A quick view of how the current scan is distributed across sources, safety states, and storage types.")) + "</div>" +
          "</div>" +
        "</div>" +
        '<div class="acp-scan-summary-body">' +
          '<div class="acp-modal-stats">' + cardHtml.join("") + "</div>" +
          '<div class="acp-scan-summary-roots">' + rootsHtml.join("") + "</div>" +
        "</div>" +
      "</article>"
    );
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
    renderScanSummary();
    renderNotices([]);
    renderResultsMeta("");
    renderStateMessage(
      ACP.t(strings, "loadingTitle", "Scanning appdata sources and saved Docker templates"),
      ACP.t(strings, "loadingMessage", "Reviewing orphaned appdata folders and active container mappings."),
      null,
      null,
      true
    );
  }

  function getActiveSweetAlertModal() {
    var $modal = $(".sweet-alert:visible").last();

    if (!$modal.length) {
      $modal = $(".sweet-alert.showSweetAlert").last();
    }

    return $modal;
  }

  function isQuarantineManagerModalVisible() {
    var $modal = getActiveSweetAlertModal();
    return !!($modal.length && $modal.hasClass("acp-quarantine-manager-modal"));
  }

  function setQuarantineEntries(entries, summary) {
    state.quarantine.entries = $.isArray(entries) ? entries : [];
    state.quarantine.summary = $.extend({ count: 0, sizeLabel: "0 B" }, summary || {});
    state.quarantine.restoreConflict = null;
    syncQuarantinePurgeInputDefaults(false);
    reconcileQuarantineSelection();
  }

  function buildDiagnosticsRedactor() {
    return {
      aliases: {
        name: {},
        template: {},
        mount: {},
        share: {},
        segment: {}
      },
      counters: {
        name: 0,
        template: 0,
        mount: 0,
        share: 0,
        segment: 0
      },
      replacements: []
    };
  }

  function getDiagnosticsAlias(redactor, kind, rawValue, tokenLabel, suffix) {
    var value = $.trim(String(rawValue || ""));
    var label = String(tokenLabel || kind || "item");
    var extension = String(suffix || "");
    var alias = "";

    if (!value) {
      return "";
    }

    if (!redactor.aliases[kind]) {
      redactor.aliases[kind] = {};
      redactor.counters[kind] = 0;
    }

    if (redactor.aliases[kind][value]) {
      return redactor.aliases[kind][value];
    }

    redactor.counters[kind] += 1;
    alias = "<" + label + "-" + String(redactor.counters[kind]) + ">" + extension;
    redactor.aliases[kind][value] = alias;
    return alias;
  }

  function registerDiagnosticsReplacement(redactor, rawValue, sanitizedValue) {
    var raw = String(rawValue || "");
    var sanitized = String(sanitizedValue || "");
    var exists = false;

    if (!raw || !sanitized || raw === sanitized) {
      return;
    }

    $.each(redactor.replacements || [], function(_, replacement) {
      if (replacement.raw === raw) {
        exists = true;
        return false;
      }

      return undefined;
    });

    if (!exists) {
      redactor.replacements.push({
        raw: raw,
        sanitized: sanitized
      });
    }
  }

  function sanitizeDiagnosticsFreeText(value, redactor) {
    var text = String(value || "");
    var replacements = (redactor && $.isArray(redactor.replacements) ? redactor.replacements.slice(0) : []).sort(function(left, right) {
      return String(right.raw || "").length - String(left.raw || "").length;
    });

    $.each(replacements, function(_, replacement) {
      var raw = String((replacement && replacement.raw) || "");
      var sanitized = String((replacement && replacement.sanitized) || "");

      if (!raw || !sanitized) {
        return;
      }

      text = text.split(raw).join(sanitized);
    });

    return text;
  }

  function sanitizeDiagnosticsName(value, redactor, tokenLabel) {
    var raw = $.trim(String(value || ""));
    var sanitized = "";

    if (!raw) {
      return "";
    }

    sanitized = getDiagnosticsAlias(redactor, "name", raw, tokenLabel || "name");
    registerDiagnosticsReplacement(redactor, raw, sanitized);
    return sanitized;
  }

  function sanitizeDiagnosticsTemplateFile(value, redactor) {
    var raw = $.trim(String(value || ""));
    var extension = "";
    var sanitized = "";

    if (!raw) {
      return "";
    }

    extension = /\.xml$/i.test(raw) ? ".xml" : "";
    sanitized = getDiagnosticsAlias(redactor, "template", raw, "template", extension);
    registerDiagnosticsReplacement(redactor, raw, sanitized);
    return sanitized;
  }

  function sanitizeDiagnosticsPath(value, redactor) {
    var raw = $.trim(String(value || ""));
    var segments;
    var sanitizedSegments;
    var sanitized = "";

    if (!raw) {
      return "";
    }

    if (raw.charAt(0) !== "/") {
      return sanitizeDiagnosticsFreeText(raw, redactor);
    }

    if (/^\/(config|data|downloads|media|cache|tmp|temp|transcode|movies|tv|music|backup|backups)(\/|$)/i.test(raw)) {
      return raw;
    }

    segments = raw.split("/");
    sanitizedSegments = segments.slice(0);

    if (raw.indexOf("/mnt/") === 0) {
      if (segments[2] && !/^(user|user0|cache|disk\d+)$/i.test(segments[2])) {
        sanitizedSegments[2] = getDiagnosticsAlias(redactor, "mount", segments[2], "mount");
      }

      if (segments[3] && !/^(appdata|system|domains|isos)$/i.test(segments[3])) {
        sanitizedSegments[3] = getDiagnosticsAlias(redactor, "share", segments[3], "share");
      }

      $.each(sanitizedSegments, function(index, segment) {
        if (index >= 4 && segment) {
          sanitizedSegments[index] = getDiagnosticsAlias(redactor, "segment", segment, "path");
        }
      });

      sanitized = sanitizedSegments.join("/");
      registerDiagnosticsReplacement(redactor, raw, sanitized);
      return sanitized;
    }

    if (raw.indexOf("/boot/") === 0) {
      $.each(sanitizedSegments, function(index, segment) {
        if (index >= 4 && segment) {
          sanitizedSegments[index] = getDiagnosticsAlias(redactor, "segment", segment, "path");
        }
      });

      sanitized = sanitizedSegments.join("/");
      registerDiagnosticsReplacement(redactor, raw, sanitized);
      return sanitized;
    }

    sanitized = getDiagnosticsAlias(redactor, "segment", raw, "path");
    registerDiagnosticsReplacement(redactor, raw, sanitized);
    return sanitized;
  }

  function sanitizeDiagnosticsTemplateRefs(templateRefs, redactor) {
    return $.map($.isArray(templateRefs) ? templateRefs : [], function(ref) {
      var record = $.isPlainObject(ref) ? $.extend({}, ref) : {};

      record.name = sanitizeDiagnosticsName(record.name || "", redactor, "app");
      record.file = sanitizeDiagnosticsTemplateFile(record.file || "", redactor);
      record.target = String(record.target || "");
      return record;
    });
  }

  function sanitizeDiagnosticsRow(row, redactor) {
    var nextRow = $.extend(true, {}, row || {});

    nextRow.name = sanitizeDiagnosticsName(nextRow.name || "", redactor, "app");
    nextRow.sourceRoot = sanitizeDiagnosticsPath(nextRow.sourceRoot || "", redactor);
    nextRow.path = sanitizeDiagnosticsPath(nextRow.path || "", redactor);
    nextRow.displayPath = sanitizeDiagnosticsPath(nextRow.displayPath || "", redactor);
    nextRow.realPath = sanitizeDiagnosticsPath(nextRow.realPath || "", redactor);
    nextRow.targetPaths = $.map($.isArray(nextRow.targetPaths) ? nextRow.targetPaths : [], function(path) {
      return sanitizeDiagnosticsPath(path, redactor);
    });
    nextRow.sourceNames = $.map($.isArray(nextRow.sourceNames) ? nextRow.sourceNames : [], function(name) {
      return sanitizeDiagnosticsName(name, redactor, "app");
    });
    nextRow.templateRefs = sanitizeDiagnosticsTemplateRefs(nextRow.templateRefs, redactor);
    nextRow.sourceDisplay = sanitizeDiagnosticsFreeText(nextRow.sourceDisplay || "", redactor);
    nextRow.sourceSummary = sanitizeDiagnosticsFreeText(nextRow.sourceSummary || "", redactor);
    nextRow.targetSummary = sanitizeDiagnosticsFreeText(nextRow.targetSummary || "", redactor);
    nextRow.datasetName = sanitizeDiagnosticsName(nextRow.datasetName || "", redactor, "dataset");
    nextRow.datasetMountpoint = sanitizeDiagnosticsPath(nextRow.datasetMountpoint || "", redactor);
    nextRow.storageDetail = sanitizeDiagnosticsFreeText(nextRow.storageDetail || "", redactor);
    nextRow.zfsResolutionMessage = sanitizeDiagnosticsFreeText(nextRow.zfsResolutionMessage || "", redactor);
    nextRow.riskReason = sanitizeDiagnosticsFreeText(nextRow.riskReason || "", redactor);
    nextRow.reason = sanitizeDiagnosticsFreeText(nextRow.reason || "", redactor);
    nextRow.securityLockReason = sanitizeDiagnosticsFreeText(nextRow.securityLockReason || "", redactor);
    nextRow.policyReason = sanitizeDiagnosticsFreeText(nextRow.policyReason || "", redactor);
    nextRow.ignoredReason = sanitizeDiagnosticsFreeText(nextRow.ignoredReason || "", redactor);

    if (nextRow.shareName && !/^(appdata|system|domains|isos)$/i.test(String(nextRow.shareName))) {
      nextRow.shareName = getDiagnosticsAlias(redactor, "share", nextRow.shareName, "share");
    }

    return nextRow;
  }

  function sanitizeDiagnosticsAuditHistory(history, redactor) {
    return $.map($.isArray(history) ? history : [], function(entry) {
      var nextEntry = $.extend(true, {}, entry || {});

      nextEntry.results = $.map($.isArray(nextEntry.results) ? nextEntry.results : [], function(result) {
        var nextResult = $.extend(true, {}, result || {});

        nextResult.name = sanitizeDiagnosticsName(nextResult.name || "", redactor, "app");
        nextResult.sourcePath = sanitizeDiagnosticsPath(nextResult.sourcePath || "", redactor);
        nextResult.destination = sanitizeDiagnosticsPath(nextResult.destination || "", redactor);
        nextResult.restoredPath = sanitizeDiagnosticsPath(nextResult.restoredPath || "", redactor);
        nextResult.displayPath = sanitizeDiagnosticsPath(nextResult.displayPath || nextResult.path || "", redactor);
        nextResult.path = sanitizeDiagnosticsPath(nextResult.path || "", redactor);
        nextResult.message = sanitizeDiagnosticsFreeText(nextResult.message || "", redactor);
        delete nextResult.row;
        return nextResult;
      });
      nextEntry.message = sanitizeDiagnosticsFreeText(nextEntry.message || "", redactor);

      return nextEntry;
    });
  }

  function sanitizeDiagnosticsSettings(settings, redactor) {
    var nextSettings = $.extend(true, {}, settings || {});

    nextSettings.quarantineRoot = sanitizeDiagnosticsPath(nextSettings.quarantineRoot || "", redactor);
    nextSettings.manualAppdataSources = $.map($.isArray(nextSettings.manualAppdataSources) ? nextSettings.manualAppdataSources : [], function(path) {
      return sanitizeDiagnosticsPath(path, redactor);
    });
    nextSettings.zfsPathMappings = $.map($.isArray(nextSettings.zfsPathMappings) ? nextSettings.zfsPathMappings : [], function(mapping) {
      return {
        shareRoot: sanitizeDiagnosticsPath(mapping && mapping.shareRoot, redactor),
        datasetRoot: sanitizeDiagnosticsPath(mapping && mapping.datasetRoot, redactor)
      };
    });

    return nextSettings;
  }

  function sanitizeDiagnosticsSourceInfo(info, redactor) {
    var nextInfo = $.extend(true, {}, info || {});

    nextInfo.detected = $.map($.isArray(nextInfo.detected) ? nextInfo.detected : [], function(path) {
      return sanitizeDiagnosticsPath(path, redactor);
    });
    nextInfo.manual = $.map($.isArray(nextInfo.manual) ? nextInfo.manual : [], function(path) {
      return sanitizeDiagnosticsPath(path, redactor);
    });
    nextInfo.effective = $.map($.isArray(nextInfo.effective) ? nextInfo.effective : [], function(path) {
      return sanitizeDiagnosticsPath(path, redactor);
    });
    nextInfo.zfsPathMappings = $.map($.isArray(nextInfo.zfsPathMappings) ? nextInfo.zfsPathMappings : [], function(mapping) {
      return {
        shareRoot: sanitizeDiagnosticsPath(mapping && mapping.shareRoot, redactor),
        datasetRoot: sanitizeDiagnosticsPath(mapping && mapping.datasetRoot, redactor)
      };
    });

    return nextInfo;
  }

  function buildDiagnosticsPayload() {
    var generatedAt = new Date();
    var visibleRows = getVisibleRows();
    var selectedRows = getSelectedRows();
    var notices = buildLocalNotices();
    var redactor = buildDiagnosticsRedactor();
    var sanitizedInsights = $.extend(true, {}, buildScanInsights());
    var sanitizedRows = $.map(state.rows || [], function(row) {
      return sanitizeDiagnosticsRow(row, redactor);
    });
    var sanitizedSettings = sanitizeDiagnosticsSettings(state.settings || {}, redactor);
    var sanitizedSourceInfo = sanitizeDiagnosticsSourceInfo(state.appdataSources || {}, redactor);
    var sanitizedAuditHistory = sanitizeDiagnosticsAuditHistory(($.isArray(state.auditHistory) ? state.auditHistory : []).slice(0, 25), redactor);

    sanitizedInsights.scanRoots = $.map($.isArray(sanitizedInsights.scanRoots) ? sanitizedInsights.scanRoots : [], function(path) {
      return sanitizeDiagnosticsPath(path, redactor);
    });

    return {
      generatedAt: generatedAt.toISOString(),
      pluginVersion: String(config.pluginVersion || ""),
      redaction: {
        sanitized: true,
        strategy: "Paths keep structural roots while app-specific segments, names, and template filenames are aliased."
      },
      hostTheme: {
        name: ACP.resolveHostThemeName ? ACP.resolveHostThemeName() : "",
        themeClass: ACP.inferThemeClass ? ACP.inferThemeClass(ACP.resolveHostThemeName ? ACP.resolveHostThemeName() : "") : ""
      },
      uiState: {
        searchTerm: $.trim(String(els.$search.val() || "")),
        riskFilter: String(state.riskFilter || "all"),
        showIgnored: !!state.showIgnored,
        sortMode: String(state.sortMode || "risk"),
        badgeFilter: state.badgeFilter || null,
        busy: !!state.busy
      },
      scan: {
        dockerRunning: !!state.dockerRunning,
        scanTokenPresent: !!state.scanToken,
        scanWarningMessage: sanitizeDiagnosticsFreeText(String(state.scanWarningMessage || ""), redactor),
        summary: $.extend({}, state.summary || {}),
        insights: sanitizedInsights,
        visibleRowCount: visibleRows.length,
        selectedRowCount: selectedRows.length,
        pendingStatCount: $.grep(state.rows || [], function(row) {
          return !!(row && row.statsPending);
        }).length
      },
      settings: sanitizedSettings,
      appdataSources: sanitizedSourceInfo,
      quarantine: {
        loaded: !!(state.quarantine && state.quarantine.loaded),
        loading: !!(state.quarantine && state.quarantine.loading),
        summary: $.extend({}, (state.quarantine && state.quarantine.summary) || {})
      },
      notices: notices,
      auditHistory: sanitizedAuditHistory,
      rows: sanitizedRows,
      visibleRowIds: $.map(visibleRows, function(row) {
        return row && row.id ? String(row.id) : null;
      }),
      selectedRowIds: $.map(selectedRows, function(row) {
        return row && row.id ? String(row.id) : null;
      })
    };
  }

  function buildDiagnosticsFilename() {
    var stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
    return "appdata-cleanup-plus-diagnostics-" + stamp + ".json";
  }

  function downloadJsonFile(filename, payload) {
    var blob = new window.Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json;charset=utf-8" });
    var url = window.URL.createObjectURL(blob);
    var link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function() {
      window.URL.revokeObjectURL(url);
    }, 0);
  }

  function exportDiagnostics() {
    try {
      downloadJsonFile(buildDiagnosticsFilename(), buildDiagnosticsPayload());
      swal(
        ACP.t(strings, "toolsDiagnosticsDoneTitle", "Diagnostics exported"),
        ACP.t(strings, "toolsDiagnosticsDoneMessage", "The diagnostics JSON has been downloaded."),
        "success"
      );
    } catch (_error) {
      swal(
        ACP.t(strings, "toolsDiagnosticsFailedTitle", "Diagnostics export failed"),
        ACP.t(strings, "toolsDiagnosticsFailedMessage", "The diagnostics file could not be created right now."),
        "error"
      );
    }
  }

  function reconcileQuarantineSelection() {
    var allowed = {};

    $.each(state.quarantine.entries || [], function(_, entry) {
      var entryId = String(entry.id || "");

      if (entryId) {
        allowed[entryId] = true;
      }
    });

    $.each(Object.keys(state.quarantine.selected || {}), function(_, entryId) {
      if (!allowed[entryId]) {
        delete state.quarantine.selected[entryId];
      }
    });
  }

  function getSelectedQuarantineEntryIds() {
    var selectedIds = [];

    $.each(state.quarantine.entries || [], function(_, entry) {
      var entryId = String(entry.id || "");

      if (entryId && state.quarantine.selected[entryId]) {
        selectedIds.push(entryId);
      }
    });

    return selectedIds;
  }

  function selectAllQuarantineEntries() {
    $.each(state.quarantine.entries || [], function(_, entry) {
      var entryId = String(entry.id || "");

      if (entryId) {
        state.quarantine.selected[entryId] = true;
      }
    });

    syncQuarantineManagerSelectionUi();
  }

  function buildQuarantineSelectionSummaryText(selectedCount) {
    return selectedCount + " " + (selectedCount === 1
      ? ACP.t(strings, "selectedSingular", "folder selected")
      : ACP.t(strings, "selectedPlural", "folders selected"));
  }

  function normalizeDefaultQuarantinePurgeDaysValue(value) {
    var rawValue = $.trim(String(value === null || value === undefined ? "" : value));
    var days = rawValue === "" ? 0 : parseInt(rawValue, 10);

    if (isNaN(days) || days < 0 || days > 3650) {
      return null;
    }

    return days;
  }

  function padDateTimeLocalSegment(value) {
    return value < 10 ? "0" + String(value) : String(value);
  }

  function formatDateTimeLocalValue(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
      return "";
    }

    return [
      date.getFullYear(),
      "-",
      padDateTimeLocalSegment(date.getMonth() + 1),
      "-",
      padDateTimeLocalSegment(date.getDate()),
      "T",
      padDateTimeLocalSegment(date.getHours()),
      ":",
      padDateTimeLocalSegment(date.getMinutes())
    ].join("");
  }

  function buildDefaultQuarantinePurgeAtInputValue(defaultPurgeDays) {
    var days = Number(defaultPurgeDays || 0);

    if (isNaN(days) || days < 0) {
      days = 0;
    }

    if (days <= 0) {
      return "";
    }

    var nextDate = new Date();
    nextDate.setSeconds(0, 0);
    nextDate.setMinutes(nextDate.getMinutes() + 1);
    nextDate.setDate(nextDate.getDate() + days);
    return formatDateTimeLocalValue(nextDate);
  }

  function syncQuarantinePurgeInputDefaults(forceReset) {
    if (forceReset || !$.trim(String(state.quarantine.purgeAtInput || ""))) {
      state.quarantine.purgeAtInput = buildDefaultQuarantinePurgeAtInputValue(state.settings.defaultQuarantinePurgeDays);
    }
  }

  function getQuarantineScheduleAtValue() {
    var $modal = getActiveSweetAlertModal();
    var $input = $modal.find(".acp-quarantine-schedule-at-input").first();
    var nextValue = $.trim(String($input.length ? $input.val() : state.quarantine.purgeAtInput || ""));
    var nextTime = nextValue ? new Date(nextValue) : null;

    if (!nextValue || !(nextTime instanceof Date) || isNaN(nextTime.getTime()) || nextTime.getTime() <= Date.now()) {
      return "";
    }

    state.quarantine.purgeAtInput = nextValue;
    return nextValue;
  }

  function syncQuarantineManagerSelectionUi() {
    var selectedIds = getSelectedQuarantineEntryIds();
    var totalEntries = (state.quarantine.entries || []).length;
    var $modal = getActiveSweetAlertModal();

    if (!$modal.length || !$modal.hasClass("acp-quarantine-manager-modal")) {
      return;
    }

    $modal.find(".acp-quarantine-selected-summary").text(buildQuarantineSelectionSummaryText(selectedIds.length));
    $modal.find(".acp-quarantine-default-purge-input")
      .prop("disabled", state.busy || state.quarantine.loading)
      .val(String(Number(state.settings.defaultQuarantinePurgeDays || 0)));
    $modal.find(".acp-quarantine-schedule-at-input")
      .prop("disabled", state.busy || state.quarantine.loading)
      .val(String(state.quarantine.purgeAtInput || ""));
    $modal.find("[data-action='select-all-quarantine']")
      .prop("disabled", state.busy || state.quarantine.loading || totalEntries === 0 || selectedIds.length >= totalEntries);
    $modal.find("[data-action='restore-selected-quarantine'], [data-action='purge-selected-quarantine'], [data-action='clear-quarantine-selection'], [data-action='set-quarantine-purge-schedule'], [data-action='clear-quarantine-purge-schedule']")
      .prop("disabled", state.busy || state.quarantine.loading || selectedIds.length === 0);
    $modal.find("[data-entry-action]")
      .prop("disabled", state.busy || state.quarantine.loading);
    $modal.find("[data-action='refresh-quarantine']")
      .prop("disabled", state.busy || state.quarantine.loading);

    $modal.find(".acp-quarantine-entry").each(function() {
      var $entry = $(this);
      var entryId = String($entry.data("entry-id") || "");
      var isSelected = !!(entryId && state.quarantine.selected[entryId]);

      $entry.toggleClass("is-selected", isSelected);
      $entry.find(".acp-quarantine-checkbox").prop("checked", isSelected);
    });
  }

  function clearQuarantineSelection() {
    state.quarantine.selected = {};
    syncQuarantineManagerSelectionUi();
  }

  function renderOpenQuarantineManagerModal() {
    if (isQuarantineManagerModalVisible()) {
      renderQuarantineManagerModal(false);
      syncQuarantineManagerSelectionUi();
    }
  }

  function reopenQuarantineManagerModal(forceRefresh) {
    window.setTimeout(function() {
      ACP.releaseModalScrollLock(true);
      openQuarantineManagerModal(!!forceRefresh);
    }, 180);
  }

  function startQuarantinePurgeScheduleFlow(mode, entryIds) {
    var requestedEntryIds = $.map($.isArray(entryIds) ? entryIds : [entryIds], function(entryId) {
      var entryKey = String(entryId || "");
      return entryKey ? entryKey : null;
    });
    var purgeAt = "";

    if (!requestedEntryIds.length) {
      swal(
        ACP.t(strings, "deleteEmptyTitle", "Nothing selected"),
        ACP.t(strings, "quarantineManagerSelectionEmptyMessage", "Select at least one quarantined folder before continuing."),
        "warning"
      );
      return;
    }

    if (mode === "set") {
      purgeAt = getQuarantineScheduleAtValue();

      if (!purgeAt) {
        swal(
          ACP.t(strings, "quarantinePurgeScheduleFailedTitle", "Purge timer update failed"),
          ACP.t(strings, "quarantinePurgeScheduleInvalidMessage", "Enter a future purge date and time."),
          "warning"
        );
        return;
      }
    }

    runQuarantinePurgeScheduleUpdate(mode, requestedEntryIds, purgeAt);
  }

  function runQuarantinePurgeScheduleUpdate(mode, entryIds, purgeAt) {
    state.quarantine.loading = true;
    setBusy(true);
    renderOpenQuarantineManagerModal();

    apiPost({
      action: "updateQuarantinePurgeSchedule",
      entryIds: JSON.stringify(entryIds),
      purgeScheduleMode: mode,
      purgeAt: purgeAt || ""
    }).done(function(response) {
      var quarantine = response.quarantine || {};

      setQuarantineEntries(quarantine.entries, quarantine.summary);
      state.quarantine.loaded = true;
      state.quarantine.loading = false;
      setBusy(false);
      renderPanels();
      renderOpenQuarantineManagerModal();
    }).fail(function(xhr) {
      state.quarantine.loading = false;
      setBusy(false);
      renderPanels();

      swal({
        title: ACP.t(strings, "quarantinePurgeScheduleFailedTitle", "Purge timer update failed"),
        text: ACP.extractErrorMessage(xhr, ACP.t(strings, "quarantinePurgeScheduleFailedMessage", "The purge timer could not be updated right now.")),
        type: "error"
      }, function() {
        reopenQuarantineManagerModal(true);
      });
    });
  }

  function buildRowMetaHtml(row) {
    var facts = [];
    var sourceLabel = row.sourceLabel || ACP.t(strings, "sourceLabel", "Source");
    var sourceText = row.sourceDisplay || row.sourceSummary || row.name;

    facts.push('<span class="acp-row-meta-item"><strong>' + ACP.escapeHtml(sourceLabel) + "</strong> " + ACP.escapeHtml(sourceText || "") + "</span>");

    if (row.targetSummary) {
      facts.push('<span class="acp-row-meta-item"><strong>' + ACP.escapeHtml(ACP.t(strings, "targetLabel", "Target")) + "</strong> " + ACP.escapeHtml(row.targetSummary) + "</span>");
    }

    if (row.storageKind === "zfs") {
      facts.push('<span class="acp-row-meta-item"><strong>' + ACP.escapeHtml(ACP.t(strings, "storageLabel", "Storage")) + "</strong> " + ACP.escapeHtml(row.datasetName || row.storageLabel || ACP.t(strings, "zfsDatasetLabel", "ZFS dataset")) + "</span>");
    } else if (row.zfsMappingMatched) {
      facts.push('<span class="acp-row-meta-item"><strong>' + ACP.escapeHtml(ACP.t(strings, "storageLabel", "Storage")) + "</strong> " + ACP.escapeHtml(ACP.t(strings, "zfsMappingPendingLabel", "Mapped share path")) + "</span>");
    }

    facts.push('<span class="acp-row-meta-item"><strong>' + ACP.escapeHtml(ACP.t(strings, "sizeLabel", "Size")) + "</strong> " + ACP.escapeHtml(row.statsPending ? ACP.t(strings, "sizeLoadingLabel", "Loading...") : (row.sizeLabel || "Unknown")) + "</span>");
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

    if (row.zfsMappingMatched && row.storageKind !== "zfs" && row.zfsResolutionMessage) {
      notes.push('<div class="acp-row-note">' + ACP.escapeHtml(row.zfsResolutionMessage) + "</div>");
    }

    if (row.lockOverridden) {
      notes.push('<div class="acp-row-note is-warning">' + ACP.escapeHtml(ACP.t(strings, "lockOverrideNote", "Manual unlock override is active for this scan only.")) + "</div>");
    }

    if (row.ignored && row.ignoredReason) {
      notes.push('<div class="acp-row-note">' + ACP.escapeHtml(row.ignoredReason) + "</div>");
    } else if (!row.policyReason && row.risk !== "safe" && row.riskReason) {
      notes.push('<div class="acp-row-note">' + ACP.escapeHtml(row.riskReason) + "</div>");
    }

    return notes.join("");
  }

  function buildRowActionHtml(row) {
    var actions = [];

    if (row.id) {
      actions.push('<button type="button" class="acp-button acp-button-secondary acp-row-action" data-row-action="details" data-row-id="' + ACP.escapeHtml(row.id || "") + '">' + ACP.escapeHtml(ACP.t(strings, "rowDetailsActionLabel", "Details")) + "</button>");
    }

    if (row.ignored) {
      actions.push('<button type="button" class="acp-button acp-button-secondary acp-row-action" data-row-action="unignore" data-row-id="' + ACP.escapeHtml(row.id || "") + '">' + ACP.escapeHtml(ACP.t(strings, "restoreActionLabel", "Restore")) + "</button>");
      return '<div class="acp-row-actions">' + actions.join("") + "</div>";
    }

    if (row.id) {
      actions.push('<button type="button" class="acp-button acp-button-secondary acp-row-action" data-row-action="ignore" data-row-id="' + ACP.escapeHtml(row.id || "") + '">' + ACP.escapeHtml(ACP.t(strings, "ignoreActionLabel", "Ignore")) + "</button>");
      return '<div class="acp-row-actions">' + actions.join("") + "</div>";
    }

    return "";
  }

  function buildResultsSectionDefinitions() {
    return [
      {
        key: "template",
        title: ACP.t(strings, "templateSectionTitle", "Saved template references"),
        message: ACP.t(strings, "templateSectionMessage", "Paths still referenced by saved Docker templates but not by installed containers.")
      },
      {
        key: "filesystem",
        title: ACP.t(strings, "discoverySectionTitle", "Appdata share discovery"),
        message: ACP.t(strings, "discoverySectionMessage", "Folders found directly in the configured appdata sources with no saved template or live container reference.")
      },
      {
        key: "ignored",
        title: ACP.t(strings, "ignoredSectionTitle", "Ignored"),
        message: ACP.t(strings, "ignoredSectionMessage", "Hidden by your ignore list. Restore them to include them in cleanup results again.")
      }
    ];
  }

  function getResultsSectionKey(row) {
    if (row.ignored) {
      return "ignored";
    }

    if (row.sourceKind === "filesystem") {
      return "filesystem";
    }

    return "template";
  }

  function sanitizeBadgeToken(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  }

  function getActiveBadgeFilter() {
    if (!state.badgeFilter || !state.badgeFilter.kind || !state.badgeFilter.value) {
      return null;
    }

    return {
      kind: String(state.badgeFilter.kind),
      value: String(state.badgeFilter.value),
      label: String(state.badgeFilter.label || state.badgeFilter.value)
    };
  }

  function isBadgeFilterActive(kind, value) {
    var filter = getActiveBadgeFilter();

    if (!filter) {
      return false;
    }

    return filter.kind === String(kind || "") && filter.value === String(value || "");
  }

  function getBadgeFilterTone(filter) {
    var value = filter && filter.value ? String(filter.value) : "";

    if (!filter) {
      return "neutral";
    }

    if (filter.kind === "actionability") {
      return value || "neutral";
    }

    if (filter.kind === "source" && value === "filesystem") {
      return "discovery";
    }

    if (filter.kind === "reason") {
      if (value === "outside_share") {
        return "review";
      }

      if (value === "override_active") {
        return "review";
      }

      if (value === "symlink" || value === "mount_point" || value === "root_path" || value === "unsafe_path" || value === "safety_lock") {
        return "locked";
      }
    }

    if (filter.kind === "storage" && value === "zfs") {
      return "neutral";
    }

    return "neutral";
  }

  function buildBadgeHtml(badge) {
    var classes = ["acp-badge", "acp-badge-tone-" + sanitizeBadgeToken(badge.tone || "neutral")];
    var kindClass = badge.kindClass || badge.kind || "";
    var interactive = badge.kind && badge.value;
    var active = interactive && isBadgeFilterActive(badge.kind, badge.value);
    var title = $.trim(String(badge.title || ""));

    if (kindClass) {
      classes.push("acp-badge-kind-" + sanitizeBadgeToken(kindClass));
    }

    if (badge.isPrimary) {
      classes.push("is-primary");
    }

    if (interactive) {
      classes.push("acp-badge-filter");

      if (active) {
        classes.push("is-active");
      }

      title = $.trim((title ? title + " " : "") + ACP.t(strings, "badgeFilterHint", "Click to filter rows by this badge."));

      return (
        '<span class="' + classes.join(" ") + '"' +
          ' data-badge-kind="' + ACP.escapeHtml(String(badge.kind)) + '"' +
          ' data-badge-value="' + ACP.escapeHtml(String(badge.value)) + '"' +
          ' data-badge-label="' + ACP.escapeHtml(String(badge.label || badge.value)) + '"' +
          ' role="button"' +
          ' tabindex="0"' +
          ' aria-pressed="' + (active ? "true" : "false") + '"' +
          (title ? ' title="' + ACP.escapeHtml(title) + '"' : "") +
        ">" + ACP.escapeHtml(String(badge.label || "")) + "</span>"
      );
    }

    return '<span class="' + classes.join(" ") + '"' + (title ? ' title="' + ACP.escapeHtml(title) + '"' : "") + ">" + ACP.escapeHtml(String(badge.label || "")) + "</span>";
  }

  function getActionabilityLabel(actionability) {
    if (actionability === "locked") {
      return ACP.t(strings, "cardBlocked", "Locked");
    }

    if (actionability === "review") {
      return ACP.t(strings, "deleteReviewCountLabel", "Review");
    }

    return ACP.t(strings, "cardDeletable", "Ready");
  }

  function getRowActionabilityDescriptor(row) {
    if (row.policyLocked || row.risk === "blocked") {
      return {
        kind: "actionability",
        value: "locked",
        label: ACP.t(strings, "cardBlocked", "Locked"),
        tone: "locked",
        title: row.policyReason || row.securityLockReason || row.riskReason || "",
        kindClass: "actionability",
        isPrimary: true
      };
    }

    if (row.risk === "review") {
      return {
        kind: "actionability",
        value: "review",
        label: row.riskLabel || ACP.t(strings, "deleteReviewCountLabel", "Review"),
        tone: "review",
        title: row.riskReason || row.policyReason || "",
        kindClass: "actionability",
        isPrimary: true
      };
    }

    return {
      kind: "actionability",
      value: "ready",
      label: row.riskLabel || ACP.t(strings, "cardDeletable", "Ready"),
      tone: "ready",
      title: row.riskReason || "",
      kindClass: "actionability",
      isPrimary: true
    };
  }

  function getRowStateDescriptor(row) {
    var title = "";

    if (row.ignored && row.ignoredReason) {
      title = row.ignoredReason;
    } else if (row.status === "docker_offline") {
      title = row.reason || row.riskReason || "";
    } else {
      title = row.reason || "";
    }

    return {
      kind: "status",
      value: String(row.status || "orphaned"),
      label: row.statusLabel || "Orphaned",
      tone: "neutral",
      title: title,
      kindClass: "status"
    };
  }

  function getRowSourceDescriptor(row) {
    return {
      kind: "source",
      value: String(row.sourceKind || "template"),
      label: row.sourceLabel || ACP.t(strings, "sourceLabel", "Source"),
      tone: row.sourceKind === "filesystem" ? "discovery" : "neutral",
      title: row.sourceDisplay || row.sourceSummary || "",
      kindClass: "source"
    };
  }

  function getRowStorageDescriptor(row) {
    if (row.storageKind !== "zfs") {
      return null;
    }

    return {
      kind: "storage",
      value: "zfs",
      label: ACP.t(strings, "badgeStorageZfs", "ZFS dataset"),
      tone: "neutral",
      title: row.datasetName || row.datasetMountpoint || "",
      kindClass: "storage"
    };
  }

  function pushBadgeDescriptor(descriptors, badge) {
    var exists;

    if (!badge || !badge.kind || !badge.value) {
      return;
    }

    exists = $.grep(descriptors, function(existing) {
      return existing.kind === badge.kind && existing.value === badge.value;
    }).length > 0;

    if (!exists) {
      descriptors.push(badge);
    }
  }

  function getRowReasonDescriptors(row) {
    var descriptors = [];
    var securityReason = String(row.securityLockReason || "");
    var policyReason = String(row.policyReason || "");
    var riskReason = String(row.riskReason || "");

    if (securityReason) {
      if (/symlink/i.test(securityReason)) {
        pushBadgeDescriptor(descriptors, {
          kind: "reason",
          value: "symlink",
          label: ACP.t(strings, "badgeReasonSymlink", "Symlink"),
          tone: "locked",
          title: securityReason,
          kindClass: "reason"
        });
      } else if (/mount-point/i.test(securityReason)) {
        pushBadgeDescriptor(descriptors, {
          kind: "reason",
          value: "mount_point",
          label: ACP.t(strings, "badgeReasonMountPoint", "Mount point"),
          tone: "locked",
          title: securityReason,
          kindClass: "reason"
        });
      } else if (/share root|mount root/i.test(securityReason)) {
        pushBadgeDescriptor(descriptors, {
          kind: "reason",
          value: "root_path",
          label: ACP.t(strings, "badgeReasonRootPath", "Root path"),
          tone: "locked",
          title: securityReason,
          kindClass: "reason"
        });
      } else if (/canonicalized safely/i.test(securityReason)) {
        pushBadgeDescriptor(descriptors, {
          kind: "reason",
          value: "unsafe_path",
          label: ACP.t(strings, "badgeReasonUnsafePath", "Unsafe path"),
          tone: "locked",
          title: securityReason,
          kindClass: "reason"
        });
      } else {
        pushBadgeDescriptor(descriptors, {
          kind: "reason",
          value: "safety_lock",
          label: ACP.t(strings, "badgeReasonSafetyLock", "Safety lock"),
          tone: "locked",
          title: securityReason,
          kindClass: "reason"
        });
      }

      return descriptors;
    }

    if (row.lockOverridden) {
      pushBadgeDescriptor(descriptors, {
        kind: "reason",
        value: "override_active",
        label: ACP.t(strings, "badgeReasonOverrideActive", "Override active"),
        tone: "review",
        title: ACP.t(strings, "lockOverrideNote", "Manual unlock override is active for this scan only."),
        kindClass: "reason"
      });
    }

    if (row.risk === "review" || /outside-share cleanup is disabled/i.test(policyReason)) {
      pushBadgeDescriptor(descriptors, {
        kind: "reason",
        value: "outside_share",
        label: ACP.t(strings, "badgeReasonOutsideShare", "Outside share"),
        tone: "review",
        title: policyReason || riskReason,
        kindClass: "reason"
      });
    }

    return descriptors;
  }

  function getRowBadgeDescriptors(row) {
    var descriptors = [getRowActionabilityDescriptor(row), getRowStateDescriptor(row), getRowSourceDescriptor(row)];
    var storageDescriptor = getRowStorageDescriptor(row);

    if (storageDescriptor) {
      descriptors.push(storageDescriptor);
    }

    return descriptors.concat(getRowReasonDescriptors(row));
  }

  function rowMatchesBadgeFilter(row, filter) {
    var reasonDescriptors;

    if (!filter) {
      return true;
    }

    if (filter.kind === "actionability") {
      return getRowActionabilityDescriptor(row).value === filter.value;
    }

    if (filter.kind === "status") {
      return String(row.status || "") === filter.value;
    }

    if (filter.kind === "source") {
      return String(row.sourceKind || "") === filter.value;
    }

    if (filter.kind === "storage") {
      return String(row.storageKind || "") === filter.value;
    }

    if (filter.kind === "reason") {
      reasonDescriptors = getRowReasonDescriptors(row);
      return $.grep(reasonDescriptors, function(descriptor) {
        return descriptor.value === filter.value;
      }).length > 0;
    }

    return true;
  }

  function buildSectionActionabilitySummary(rows) {
    var summary = { ready: 0, review: 0, locked: 0 };

    $.each(rows || [], function(_, row) {
      var actionability = getRowActionabilityDescriptor(row).value;

      if (Object.prototype.hasOwnProperty.call(summary, actionability)) {
        summary[actionability] += 1;
      }
    });

    return summary;
  }

  function groupVisibleRowsBySection(rows) {
    var sections = {};

    $.each(buildResultsSectionDefinitions(), function(_, definition) {
      sections[definition.key] = {
        key: definition.key,
        title: definition.title,
        message: definition.message,
        rows: []
      };
    });

    $.each(rows || [], function(_, row) {
      var key = getResultsSectionKey(row);

      if (!sections[key]) {
        sections[key] = {
          key: key,
          title: row.sourceLabel || ACP.t(strings, "sourceLabel", "Source"),
          message: "",
          rows: []
        };
      }

      sections[key].rows.push(row);
    });

    return $.grep($.map(buildResultsSectionDefinitions(), function(definition) {
      return sections[definition.key];
    }), function(section) {
      return section && section.rows.length;
    });
  }

  function buildSectionMetaHtml(rows) {
    var badges = [];
    var summary = buildSectionActionabilitySummary(rows);

    badges.push(buildBadgeHtml({
      label: String((rows || []).length || 0) + " " + ACP.t(strings, "visibleSummary", "visible"),
      tone: "neutral",
      kindClass: "count"
    }));

    $.each(["locked", "review", "ready"], function(_, actionability) {
      var count = Number(summary[actionability] || 0);

      if (!count) {
        return;
      }

      badges.push(buildBadgeHtml({
        kind: "actionability",
        value: actionability,
        label: String(count) + " " + getActionabilityLabel(actionability),
        tone: actionability,
        kindClass: "count"
      }));
    });

    return '<div class="acp-results-section-badges">' + badges.join("") + "</div>";
  }

  function buildRowHtml(row) {
    var isSelected = !!state.selected[row.id];
    var selectable = isRowSelectable(row);
    var rowClass = "acp-row";
    var rowActionHtml = buildRowActionHtml(row);
    var rowNotesHtml = buildRowNotesHtml(row);
    var badgeHtml = $.map(getRowBadgeDescriptors(row), function(badge) {
      return buildBadgeHtml(badge);
    }).join("");

    if (isSelected) {
      rowClass += " is-selected";
    }
    if (row.ignored) {
      rowClass += " is-ignored";
    }
    if (!selectable) {
      rowClass += " is-disabled";
    } else {
      rowClass += " is-clickable";
    }

    return (
      '<article class="' + rowClass + '" data-row-id="' + ACP.escapeHtml(row.id) + '">' +
        '<div class="acp-row-check">' +
          '<input type="checkbox" class="acp-row-checkbox" data-row-id="' + ACP.escapeHtml(row.id) + '"' + (isSelected ? " checked" : "") + (selectable ? "" : " disabled") + ">" +
        "</div>" +
        '<div class="acp-row-main">' +
          '<div class="acp-row-primary">' +
            '<div class="acp-row-title-wrap">' +
              '<div class="acp-row-title-line">' +
                '<h3 class="acp-row-title">' + ACP.escapeHtml(row.name || row.displayPath || "") + "</h3>" +
              "</div>" +
              '<div class="acp-row-meta">' + buildRowMetaHtml(row) + "</div>" +
              (rowNotesHtml ? '<div class="acp-row-notes">' + rowNotesHtml + "</div>" : "") +
            "</div>" +
            '<div class="acp-row-side">' +
              '<div class="acp-row-side-head">' +
                '<div class="acp-row-badges">' +
                  badgeHtml +
                "</div>" +
                '<code class="acp-row-path">' + ACP.escapeHtml(row.displayPath || "") + "</code>" +
              "</div>" +
              rowActionHtml +
            "</div>" +
          "</div>" +
        "</div>" +
      "</article>"
    );
  }

  function renderResults() {
    var visibleRows = getVisibleRows();
    var sections = [];
    var html = [];

    if (!state.rows.length) {
      renderStateMessage(
        ACP.t(strings, "emptyTitle", "No orphaned appdata found"),
        ACP.t(strings, "emptyMessage", "Nothing currently looks safe to clean up from the configured appdata sources or saved Docker templates."),
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
        ACP.t(strings, "noMatchesMessage", "Clear the search, badge, or risk filters to see the full scan again."),
        "clear-filters",
        ACP.t(strings, "clearFiltersLabel", "Clear filters")
      );
      return;
    }

    sections = groupVisibleRowsBySection(visibleRows);

    $.each(sections, function(_, section) {
      var rowHtml = [];

      $.each(section.rows || [], function(__, row) {
        rowHtml.push(buildRowHtml(row));
      });

      html.push(
        '<section class="acp-results-section acp-results-section-' + ACP.escapeHtml(section.key || "group") + '">' +
          '<header class="acp-results-section-head">' +
            '<div class="acp-results-section-copy">' +
              '<h3 class="acp-results-section-title">' + ACP.escapeHtml(section.title || "") + "</h3>" +
              (section.message ? '<p class="acp-results-section-message">' + ACP.escapeHtml(section.message) + "</p>" : "") +
            "</div>" +
            '<div class="acp-results-section-meta">' + buildSectionMetaHtml(section.rows || []) + "</div>" +
          "</header>" +
          '<div class="acp-results-section-body">' + rowHtml.join("") + "</div>" +
        "</section>"
      );
    });

    els.$results.html(html.join(""));
  }

  function renderResultsMeta() {
    var badgeFilter = getActiveBadgeFilter();
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

    if (!badgeFilter) {
      els.$resultsMeta.text(parts.join(" | "));
      return;
    }

    els.$resultsMeta.html(
      '<span class="acp-results-meta-copy">' + ACP.escapeHtml(parts.join(" | ")) + "</span>" +
      '<span class="acp-results-meta-filter-label">' + ACP.escapeHtml(ACP.t(strings, "filteredByLabel", "Filtered by")) + "</span>" +
      buildBadgeHtml({
        kind: badgeFilter.kind,
        value: badgeFilter.value,
        label: badgeFilter.label,
        tone: getBadgeFilterTone(badgeFilter),
        kindClass: "meta"
      })
    );
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
    var badgeFilter = getActiveBadgeFilter();
    var term = $.trim(String(els.$search.val() || "")).toLowerCase();

    return $.grep(state.rows || [], function(row) {
      var haystack = ((row.name || "") + " " + (row.displayPath || "") + " " + (row.sourceSummary || "") + " " + (row.targetSummary || "")).toLowerCase();

      if (!state.showIgnored && row.ignored) {
        return false;
      }

      if (state.riskFilter !== "all" && row.risk !== state.riskFilter) {
        return false;
      }

      if (badgeFilter && !rowMatchesBadgeFilter(row, badgeFilter)) {
        return false;
      }

      if (term && haystack.indexOf(term) === -1) {
        return false;
      }

      return true;
    }).sort(compareRows);
  }

  function compareRows(left, right) {
    var actionabilityRank = { locked: 0, review: 1, ready: 2 };
    var leftActionability = getRowActionabilityDescriptor(left).value;
    var rightActionability = getRowActionabilityDescriptor(right).value;
    var leftName = String(left.name || "").toLowerCase();
    var rightName = String(right.name || "").toLowerCase();
    var leftPath = String(left.displayPath || left.path || "").toLowerCase();
    var rightPath = String(right.displayPath || right.path || "").toLowerCase();
    var leftRank = Object.prototype.hasOwnProperty.call(actionabilityRank, leftActionability) ? actionabilityRank[leftActionability] : 9;
    var rightRank = Object.prototype.hasOwnProperty.call(actionabilityRank, rightActionability) ? actionabilityRank[rightActionability] : 9;

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
      if (isRowSelectable(row)) {
        state.selected[row.id] = true;
      }
    });

    renderResults();
    renderSummaryCards();
    updateActionBar();
  }

  function selectAllRows() {
    $.each(state.rows || [], function(_, row) {
      if (isRowSelectable(row)) {
        state.selected[row.id] = true;
      }
    });

    renderResults();
    renderSummaryCards();
    updateActionBar();
  }

  function updateActionBar() {
    var selectedRows = getSelectedRows();
    var selectedActionRows = getSelectedActionRows();
    var selectedUnlockRows = getSelectedLockOverrideRows("unlock");
    var totalSelectableCount = $.grep(state.rows || [], function(row) {
      return isRowSelectable(row);
    }).length;
    var visibleSelectableCount = $.grep(getVisibleRows(), function(row) {
      return isRowSelectable(row);
    }).length;
    var reviewSelected = $.grep(selectedActionRows, function(row) {
      return row.risk === "review";
    }).length;
    var summaryText = selectedRows.length + " " + (selectedRows.length === 1 ? ACP.t(strings, "selectedSingular", "folder selected") : ACP.t(strings, "selectedPlural", "folders selected"));
    var detailText = ACP.t(strings, "selectionHintIdle", "Click rows to select. Outside-share review rows can be selected for manual unlock, but hard-locked paths stay blocked.");

    if (!state.scanToken && Number(state.summary.total || 0) > 0) {
      detailText = ACP.t(strings, "selectionHintReadOnly", "Scan results are read-only right now because the secure action snapshot could not be created.");
    } else if (selectedUnlockRows.length > 0) {
      detailText = ACP.t(strings, "selectionHintUnlock", "Selected review rows are locked by outside-share safety. Use Unlock selected to allow them for this scan.");
    } else if (!state.settings.allowOutsideShareCleanup && Number(state.summary.review || 0) > 0) {
      detailText = ACP.t(strings, "selectionHintSafety", "Outside-share cleanup is disabled. Select review rows and use Unlock selected to allow them for this scan.");
    } else if (reviewSelected > 0 && state.settings.enablePermanentDelete) {
      detailText = ACP.t(strings, "selectionHintReview", "Review rows still need extra scrutiny before permanent delete.");
    } else if (selectedActionRows.length && state.settings.enablePermanentDelete) {
      detailText = ACP.t(strings, "selectionHintDeleteMode", "Permanent delete requires typed confirmation.");
    } else if (selectedActionRows.length) {
      detailText = ACP.t(strings, "selectionHintQuarantineMode", "Selected folders will be moved into quarantine instead of being permanently deleted.");
    }

    els.$selectionSummary.text(summaryText);
    els.$selectionDetail.text(detailText);
    els.$primaryAction.text(getPrimaryActionLabel());
    els.$primaryAction.prop("disabled", state.busy || !state.scanToken || selectedActionRows.length === 0);
    els.$dryRun.prop("disabled", state.busy || !state.scanToken || selectedActionRows.length === 0);
    els.$selectAll.prop("disabled", state.busy || totalSelectableCount === 0 || selectedRows.length >= totalSelectableCount);
    els.$selectVisible.prop("disabled", state.busy || visibleSelectableCount === 0);
    els.$clearSelection.prop("disabled", state.busy || selectedRows.length === 0);

    if (typeof ACP.syncModeStripLockOverrideButton === "function") {
      ACP.syncModeStripLockOverrideButton(buildContext());
    }
  }

  function getSelectedRows() {
    return $.grep(state.rows, function(row) {
      return !!state.selected[row.id] && isRowSelectable(row);
    });
  }

  function getSelectedActionRows() {
    return $.grep(getSelectedRows(), function(row) {
      return !!row.canDelete;
    });
  }

  function getSelectedLockOverrideRows(intent) {
    return $.grep(getSelectedRows(), function(row) {
      return intent === "relock" ? isRowRelockable(row) : isRowPendingLockOverride(row);
    });
  }

  function clearFilters() {
    state.riskFilter = "all";
    state.showIgnored = false;
    state.badgeFilter = null;
    els.$search.val("");
    els.$riskFilter.val("all");
    els.$showIgnored.prop("checked", false);
    renderResults();
    renderResultsMeta();
    updateActionBar();
  }

  function saveSafetySettings(overrides, options) {
    var normalizedOverrides = $.isPlainObject(overrides) ? overrides : {};
    var normalizedOptions = $.isPlainObject(options) ? options : {};
    var previousSettings = $.extend({}, ACP.defaultSafetySettings(), state.settings || {});
    var previousRows = state.rows.slice(0);
    var previousSummary = $.extend({}, state.summary || {});
    var previousAppdataSources = $.extend(true, { detected: [], manual: [], effective: [], zfsPathMappings: [] }, state.appdataSources || {});
    var wasQuarantineManagerVisible = isQuarantineManagerModalVisible();
    var nextSettings = $.extend({}, previousSettings, {
      allowOutsideShareCleanup: !!els.$allowExternal.prop("checked"),
      enablePermanentDelete: !!els.$enableDelete.prop("checked"),
      enableZfsDatasetDelete: !!els.$enableZfsDelete.prop("checked")
    }, normalizedOverrides);
    var nextDefaultPurgeDays = normalizeDefaultQuarantinePurgeDaysValue(nextSettings.defaultQuarantinePurgeDays);

    if (nextDefaultPurgeDays === null) {
      nextDefaultPurgeDays = previousSettings.defaultQuarantinePurgeDays;
    }

    nextSettings.defaultQuarantinePurgeDays = nextDefaultPurgeDays;

    state.settings = nextSettings;
    syncSafetyControls();
    renderPanels();
    if (normalizedOptions.resetQuarantineScheduleInput) {
      syncQuarantinePurgeInputDefaults(true);
    }
    if (wasQuarantineManagerVisible || normalizedOptions.syncQuarantineModal) {
      renderOpenQuarantineManagerModal();
    }
    updateActionBar();

    setBusy(true);

    var requestData = {
      action: "saveSafetySettings",
      allowOutsideShareCleanup: nextSettings.allowOutsideShareCleanup ? "1" : "0",
      enablePermanentDelete: nextSettings.enablePermanentDelete ? "1" : "0",
      enableZfsDatasetDelete: nextSettings.enableZfsDatasetDelete ? "1" : "0",
      defaultQuarantinePurgeDays: String(Number(nextSettings.defaultQuarantinePurgeDays || 0)),
      manualAppdataSources: ($.isArray(nextSettings.manualAppdataSources) ? nextSettings.manualAppdataSources : []).join("\n"),
      zfsPathMappings: JSON.stringify($.isArray(nextSettings.zfsPathMappings) ? nextSettings.zfsPathMappings : [])
    };

    if (state.scanToken) {
      requestData.scanToken = state.scanToken;
    }

    apiPost(requestData).done(function(response) {
      var quarantine = response.quarantine || null;
      var zfsModalWasVisible = isZfsPathMappingsModalVisible();

      state.settings = $.extend({}, ACP.defaultSafetySettings(), response.settings || nextSettings);
      setAppdataSourceInfo(response.appdataSourceInfo || {});
      state.appdataSourceBrowser.manual = normalizeManualAppdataSourcesInput((state.settings || {}).manualAppdataSources || []);
      syncZfsPathMappingBrowserFromSettings();
      if (quarantine) {
        setQuarantineEntries(quarantine.entries, quarantine.summary);
        state.quarantine.loaded = true;
      }
      if (normalizedOptions.resetQuarantineScheduleInput) {
        syncQuarantinePurgeInputDefaults(true);
      }
      syncSafetyControls();
      applyLocalSafetyState();
      reconcileSelection();
      setBusy(false);
      if (!normalizedOptions.skipRenderAll) {
        renderAll();
      }
      if (isAppdataSourcesModalVisible()) {
        renderAppdataSourcesModal();
      }
      if (zfsModalWasVisible && previousSettings.enableZfsDatasetDelete && !state.settings.enableZfsDatasetDelete) {
        swal(
          ACP.t(strings, "zfsPathMappingsDisabledTitle", "ZFS mappings closed"),
          ACP.t(strings, "zfsPathMappingsDisabledMessage", "ZFS dataset delete was turned off, so the ZFS mappings editor has been closed."),
          "info"
        );
      } else if (isZfsPathMappingsModalVisible()) {
        renderZfsPathMappingsModal();
      }
      if (wasQuarantineManagerVisible || normalizedOptions.syncQuarantineModal) {
        renderOpenQuarantineManagerModal();
      }
      if (typeof normalizedOptions.onSuccess === "function") {
        normalizedOptions.onSuccess(response);
      }
      if (normalizedOptions.reloadScanOnSuccess) {
        loadScan();
      }
    }).fail(function(xhr) {
      state.settings = previousSettings;
      state.rows = previousRows;
      state.summary = previousSummary;
      state.appdataSources = previousAppdataSources;
      if (normalizedOptions.resetQuarantineScheduleInput) {
        syncQuarantinePurgeInputDefaults(true);
      }
      syncSafetyControls();
      setBusy(false);
      if (typeof normalizedOptions.onFailure === "function") {
        normalizedOptions.onFailure(xhr);
      } else if (wasQuarantineManagerVisible && normalizedOptions.reopenQuarantineModalOnFailure) {
        swal({
          title: normalizedOptions.failureTitle || ACP.t(strings, "settingsSaveFailedTitle", "Safety settings failed"),
          text: ACP.extractErrorMessage(xhr, normalizedOptions.failureMessage || ACP.t(strings, "settingsSaveFailedMessage", "The new safety settings could not be saved right now.")),
          type: "error"
        }, function() {
          reopenQuarantineManagerModal(false);
        });
      } else {
        swal(normalizedOptions.failureTitle || ACP.t(strings, "settingsSaveFailedTitle", "Safety settings failed"), ACP.extractErrorMessage(xhr, normalizedOptions.failureMessage || ACP.t(strings, "settingsSaveFailedMessage", "The new safety settings could not be saved right now.")), "error");
      }
      if (xhr && xhr.status === 409) {
        loadScan();
      } else {
        renderAll();
        if (isAppdataSourcesModalVisible()) {
          renderAppdataSourcesModal();
        }
        if (isZfsPathMappingsModalVisible()) {
          renderZfsPathMappingsModal();
        }
        updateActionBar();
      }
    });
  }

  function applyLocalOperationResults(results) {
    var removableStatuses = {
      quarantined: true,
      deleted: true,
      missing: true
    };
    var removedPaths = {};
    var removedAny = false;

    $.each(results || [], function(_, result) {
      var status = String((result && result.status) || "");
      var path = String((result && (result.displayPath || result.path)) || "");

      if (removableStatuses[status] && path) {
        removedPaths[path] = true;
      }
    });

    if (!Object.keys(removedPaths).length) {
      return false;
    }

    state.rows = $.grep(state.rows || [], function(row) {
      var path = String((row && (row.displayPath || row.path)) || "");

      if (!removedPaths[path]) {
        return true;
      }

      removedAny = true;
      delete state.selected[row.id];
      return false;
    });

    if (!removedAny) {
      return false;
    }

    state.summary = buildLocalSummary(state.rows);
    reconcileSelection();
    return true;
  }

  function applyRestoredRows(results) {
    var restoredRows = [];
    var rowsById = {};
    var mergedRows = [];

    $.each(state.rows || [], function(_, row) {
      rowsById[String((row && row.id) || "")] = row;
    });

    $.each(results || [], function(_, result) {
      var row = result && result.row;

      if (String((result && result.status) || "") !== "restored" || !row || !row.id) {
        return;
      }

      rowsById[String(row.id)] = applyLocalSafetyStateToRow($.extend({}, row));
      restoredRows.push(row);
    });

    if (!restoredRows.length) {
      return false;
    }

    $.each(Object.keys(rowsById), function(_, rowId) {
      if (rowId) {
        mergedRows.push(rowsById[rowId]);
      }
    });

    state.rows = mergedRows;
    state.summary = buildLocalSummary(state.rows);
    reconcileSelection();
    return true;
  }

  function applyLocalCandidateState(rowIds, intent) {
    var targetIds = {};
    var found = false;

    $.each($.isArray(rowIds) ? rowIds : [rowIds], function(_, rowId) {
      var rowKey = String(rowId || "");

      if (rowKey) {
        targetIds[rowKey] = true;
      }
    });

    state.rows = $.map(state.rows || [], function(row) {
      var nextRow;

      if (!targetIds[String(row.id || "")]) {
        return row;
      }

      found = true;
      nextRow = $.extend({}, row);

      if (intent === "ignore") {
        nextRow.ignored = true;
        nextRow.ignoredAt = "";
        nextRow.ignoredAtLabel = "";
        nextRow.ignoredReason = "This folder is hidden by your ignore list. Restore it to include this folder in cleanup scans again.";
        nextRow.status = "ignored";
        nextRow.statusLabel = "Ignored";
      } else if (intent === "unignore") {
        nextRow.ignored = false;
        nextRow.ignoredAt = "";
        nextRow.ignoredAtLabel = "";
        nextRow.ignoredReason = "";
        nextRow.status = state.dockerRunning ? "orphaned" : "docker_offline";
        nextRow.statusLabel = state.dockerRunning ? "Orphaned" : "Docker offline";
      } else if (intent === "unlock") {
        nextRow.lockOverridden = true;
      } else if (intent === "relock") {
        nextRow.lockOverridden = false;
      }

      return applyLocalSafetyStateToRow(nextRow);
    });

    if (!found) {
      return false;
    }

    state.summary = buildLocalSummary(state.rows);
    reconcileSelection();
    return true;
  }

  function postCandidateStateIntent(rowIds, intent, options) {
    var normalizedOptions = $.isPlainObject(options) ? options : {};
    var normalizedRowIds = [];

    $.each($.isArray(rowIds) ? rowIds : [rowIds], function(_, rowId) {
      var rowKey = String(rowId || "");

      if (rowKey && $.inArray(rowKey, normalizedRowIds) === -1) {
        normalizedRowIds.push(rowKey);
      }
    });

    if (!normalizedRowIds.length) {
      return;
    }

    setBusy(true);

    apiPost({
      action: "updateCandidateState",
      scanToken: state.scanToken,
      candidateIds: JSON.stringify(normalizedRowIds),
      intent: intent
    }).done(function(response) {
      var updated = applyLocalCandidateState(normalizedRowIds, intent);
      var nextScanToken = $.trim(String((response && response.scanToken) || state.scanToken || ""));

      setBusy(false);

      if (nextScanToken) {
        state.scanToken = nextScanToken;
      }

      if (!updated || !nextScanToken) {
        loadScan();
        return;
      }

      renderAll();
    }).fail(function(xhr) {
      setBusy(false);
      swal(
        normalizedOptions.failureTitle || ACP.t(strings, "settingsSaveFailedTitle", "Safety settings failed"),
        ACP.extractErrorMessage(xhr, normalizedOptions.failureMessage || ACP.t(strings, "settingsSaveFailedMessage", "The new safety settings could not be saved right now.")),
        "error"
      );
      if (xhr && xhr.status === 409) {
        loadScan();
      }
    });
  }

  function postRowAction(action, rowId) {
    var intent = action === "unignore" ? "unignore" : "ignore";

    postCandidateStateIntent([rowId], intent, {
      failureTitle: action === "unignore" ? ACP.t(strings, "restoreFailedTitle", "Restore failed") : ACP.t(strings, "ignoreFailedTitle", "Ignore failed"),
      failureMessage: action === "unignore" ? ACP.t(strings, "restoreFailedMessage", "The ignore list could not be updated right now.") : ACP.t(strings, "ignoreFailedMessage", "The ignore list could not be updated right now.")
    });
  }

  function buildLockOverridePreviewHtml(rows, intent) {
    var isUnlock = intent !== "relock";
    var preview = rows.slice(0, 6);
    var listTitle = isUnlock
      ? ACP.t(strings, "lockOverrideUnlockListTitle", "Folders to unlock")
      : ACP.t(strings, "lockOverrideRelockListTitle", "Folders to relock");
    var html = [
      '<div class="acp-modal-summary">',
      '<div class="acp-modal-flag">' + ACP.escapeHtml(isUnlock ? ACP.t(strings, "lockOverrideUnlockButton", "Unlock") : ACP.t(strings, "lockOverrideRelockButton", "Relock")) + "</div>",
      '<div class="acp-modal-copy">',
      '<div class="acp-modal-lead">' + ACP.escapeHtml(isUnlock ? ACP.t(strings, "lockOverrideUnlockMessage", "The selected review folders will be manually unlocked for this scan only.") : ACP.t(strings, "lockOverrideRelockMessage", "The selected review folders will return to their locked review state for this scan.")) + "</div>",
      '<div class="acp-modal-subcopy">' + ACP.escapeHtml(isUnlock ? ACP.t(strings, "lockOverrideUnlockDetail", "This bypass only applies to outside-share policy locks. Hard safety locks stay blocked.") : ACP.t(strings, "lockOverrideRelockDetail", "This removes the temporary manual unlock override from the selected review folders.")) + "</div>",
      "</div>",
      '<div class="acp-modal-stats"><span class="acp-modal-stat is-review">' + ACP.escapeHtml(String(rows.length)) + " " + ACP.escapeHtml(rows.length === 1 ? ACP.t(strings, "selectedSingular", "folder selected") : ACP.t(strings, "selectedPlural", "folders selected")) + "</span></div>",
      '<div class="acp-modal-panel">',
      '<div class="acp-modal-panel-title">' + ACP.escapeHtml(listTitle) + "</div>",
      '<ul class="acp-modal-list">'
    ];

    $.each(preview, function(_, row) {
      html.push('<li><code class="acp-modal-path">' + ACP.escapeHtml(row.displayPath || row.path || "") + "</code>");
      if (row.datasetName) {
        html.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "zfsDatasetLabel", "ZFS dataset")) + '</span><code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(row.datasetName) + "</code></div>");
      }
      html.push("</li>");
    });

    if (rows.length > preview.length) {
      html.push('<li class="acp-modal-list-more">+' + ACP.escapeHtml(String(rows.length - preview.length)) + " more</li>");
    }

    html.push("</ul></div></div>");
    return html.join("");
  }

  function startSelectedLockOverrideFlow(intent) {
    var normalizedIntent = intent === "relock" ? "relock" : "unlock";
    var targetRows = getSelectedLockOverrideRows(normalizedIntent);
    var isUnlock = normalizedIntent === "unlock";
    var confirmTitle = isUnlock
      ? ACP.t(strings, "lockOverrideUnlockTitle", "Unlock selected review folders?")
      : ACP.t(strings, "lockOverrideRelockTitle", "Relock selected review folders?");
    var confirmButtonText = isUnlock
      ? ACP.t(strings, "lockOverrideUnlockButton", "Unlock")
      : ACP.t(strings, "lockOverrideRelockButton", "Relock");

    if (!targetRows.length) {
      swal(
        ACP.t(strings, "lockOverrideEmptyTitle", "Nothing to update"),
        ACP.t(strings, "lockOverrideEmptyMessage", "Select at least one outside-share review row before using the lock override control."),
        "warning"
      );
      return;
    }

    swal({
      title: confirmTitle,
      text: "",
      type: "warning",
      html: true,
      showCancelButton: true,
      closeOnConfirm: true,
      confirmButtonText: confirmButtonText + " " + String(targetRows.length)
    }, function(confirmed) {
      if (!confirmed) {
        return;
      }

      postCandidateStateIntent($.map(targetRows, function(row) {
        return row.id;
      }), normalizedIntent, {
        failureTitle: ACP.t(strings, "lockOverrideFailedTitle", "Lock override failed"),
        failureMessage: ACP.t(strings, "lockOverrideFailedMessage", "The selected review folders could not be updated right now.")
      });
    });
    ACP.applyDeleteModalClass("acp-delete-modal", buildLockOverridePreviewHtml(targetRows, normalizedIntent));
  }

  function buildOperationContext(operation, rows) {
    var baseOperation = String(operation || "").replace(/^preview_/, "");
    var preview = baseOperation !== operation;
    var isDelete = baseOperation === "delete";
    var operationRows = $.isArray(rows) ? rows : [];
    var zfsCount = $.grep(operationRows, function(row) {
      return row && row.storageKind === "zfs";
    }).length;
    var folderCount = Math.max(0, operationRows.length - zfsCount);
    var deleteTargetLabelSingular = ACP.t(strings, "deleteFolderSingular", "folder");
    var deleteTargetLabelPlural = ACP.t(strings, "deleteFolderPlural", "folders");
    var deleteActionLabel = ACP.t(strings, "deleteConfirmButton", "Delete");
    var deleteListTitle = ACP.t(strings, "deleteListTitle", "Folders to delete");
    var deleteLoadingTitle = ACP.t(strings, "deletingTitle", "Deleting selected folders");
    var deleteLoadingMessage = ACP.t(strings, "deletingMessage", "Large folders can take a moment to remove.");
    var deleteConfirmTitle = ACP.t(strings, "deleteConfirmTitle", "Delete selected folders?");
    var deleteConfirmMessage = ACP.t(strings, "deleteConfirmMessage", "Selected folders will be removed immediately.");
    var deleteDetailMessage = ACP.t(strings, "deleteIrreversibleMessage", "This action cannot be undone by this plugin.");

    if (zfsCount > 0 && folderCount === 0) {
      deleteTargetLabelSingular = ACP.t(strings, "deleteDatasetSingular", "dataset");
      deleteTargetLabelPlural = ACP.t(strings, "deleteDatasetPlural", "datasets");
      deleteActionLabel = ACP.t(strings, "deleteDatasetActionLabel", "Destroy");
      deleteListTitle = ACP.t(strings, "deleteDatasetListTitle", "Datasets to destroy");
      deleteLoadingTitle = ACP.t(strings, "destroyingTitle", "Destroying selected datasets");
      deleteLoadingMessage = ACP.t(strings, "destroyingMessage", "ZFS dataset destroy can take a moment to validate and complete.");
      deleteConfirmTitle = ACP.t(strings, "destroyConfirmTitle", "Destroy selected datasets?");
      deleteConfirmMessage = ACP.t(strings, "destroyConfirmMessage", "Selected ZFS datasets will be destroyed immediately.");
      deleteDetailMessage = ACP.t(strings, "destroyIrreversibleMessage", "This permanently destroys the selected datasets. Quarantine is not available for ZFS dataset-backed rows.");
    } else if (zfsCount > 0) {
      deleteTargetLabelSingular = ACP.t(strings, "deleteItemSingular", "item");
      deleteTargetLabelPlural = ACP.t(strings, "deleteItemPlural", "items");
      deleteActionLabel = ACP.t(strings, "deleteMixedActionLabel", "Delete");
      deleteListTitle = ACP.t(strings, "deleteMixedListTitle", "Items to delete");
      deleteLoadingTitle = ACP.t(strings, "deletingMixedTitle", "Deleting selected items");
      deleteLoadingMessage = ACP.t(strings, "deletingMixedMessage", "Folder deletes and dataset destroys can take a moment to complete.");
      deleteConfirmTitle = ACP.t(strings, "deleteMixedConfirmTitle", "Delete selected items?");
      deleteConfirmMessage = ACP.t(strings, "deleteMixedConfirmMessage", "Selected folders and ZFS datasets will be removed immediately.");
      deleteDetailMessage = ACP.t(strings, "deleteMixedIrreversibleMessage", "This action cannot be undone by this plugin. ZFS dataset-backed rows are destroyed instead of being quarantined.");
    }

    return {
      operation: operation,
      preview: preview,
      baseOperation: baseOperation,
      confirmTitle: isDelete ? deleteConfirmTitle : ACP.t(strings, "quarantineConfirmTitle", "Quarantine selected folders?"),
      confirmMessage: isDelete ? deleteConfirmMessage : ACP.t(strings, "quarantineConfirmMessage", "Selected folders will be moved into quarantine instead of being permanently deleted."),
      detailMessage: isDelete ? deleteDetailMessage : ACP.t(strings, "quarantineDetailMessage", "The selected folders will be moved into the quarantine root instead of being permanently deleted."),
      confirmButtonLabel: isDelete ? deleteActionLabel : ACP.t(strings, "quarantineConfirmButton", "Quarantine"),
      loadingTitle: preview ? ACP.t(strings, "dryRunTitle", "Running dry run") : (isDelete ? deleteLoadingTitle : ACP.t(strings, "quarantiningTitle", "Moving selected folders to quarantine")),
      loadingMessage: preview ? ACP.t(strings, "dryRunMessage", "Reviewing what the current action would do without changing anything.") : (isDelete ? deleteLoadingMessage : ACP.t(strings, "quarantiningMessage", "Selected folders are being moved into a hidden quarantine root.")),
      resultTitleSuccess: preview ? ACP.t(strings, "dryRunResultTitleSuccess", "Dry run complete") : (isDelete ? ACP.t(strings, "deleteResultTitleSuccess", "Cleanup complete") : ACP.t(strings, "quarantineResultTitleSuccess", "Quarantine complete")),
      resultTitleWarning: preview ? ACP.t(strings, "dryRunResultTitleWarning", "Dry run finished with warnings") : (isDelete ? ACP.t(strings, "deleteResultTitleWarning", "Cleanup finished with warnings") : ACP.t(strings, "quarantineResultTitleWarning", "Quarantine finished with warnings")),
      failureTitle: isDelete ? ACP.t(strings, "deleteFailedTitle", "Delete failed") : ACP.t(strings, "quarantineFailedTitle", "Quarantine failed"),
      listTitle: preview
        ? (isDelete ? deleteListTitle : ACP.t(strings, "quarantineListTitle", "Folders to quarantine"))
        : (isDelete ? deleteListTitle : ACP.t(strings, "quarantineListTitle", "Folders to quarantine")),
      successStatus: preview ? "ready" : (isDelete ? "deleted" : "quarantined"),
      warningLabel: preview ? ACP.t(strings, "previewWarningLabel", "DRY RUN") : ACP.t(strings, "deleteWarningLabel", "WARNING"),
      deleteTargetLabelSingular: deleteTargetLabelSingular,
      deleteTargetLabelPlural: deleteTargetLabelPlural
    };
  }

  function buildActionConfirmButtonText(context, count) {
    var noun = count === 1 ? context.deleteTargetLabelSingular : context.deleteTargetLabelPlural;
    return context.confirmButtonLabel + " " + count + " " + noun;
  }

  function selectionIncludesZfsRows(rows) {
    return $.grep($.isArray(rows) ? rows : [], function(row) {
      return row && row.storageKind === "zfs";
    }).length > 0;
  }

  function formatPreviewList(values, totalCount) {
    var previewValues = $.isArray(values) ? values : [];
    var previewCount = previewValues.length;
    var suffix = "";

    if (typeof totalCount === "number" && totalCount > previewCount) {
      suffix = " (+" + String(totalCount - previewCount) + " more)";
    }

    return previewValues.join(", ") + suffix;
  }

  function getDeleteTypedTitle(context) {
    if (context.confirmButtonLabel === ACP.t(strings, "deleteDatasetActionLabel", "Destroy")) {
      return ACP.t(strings, "destroyTypedTitle", "Type DELETE to confirm dataset destroy");
    }

    if (context.deleteTargetLabelPlural === ACP.t(strings, "deleteItemPlural", "items")) {
      return ACP.t(strings, "deleteMixedTypedTitle", "Type DELETE to confirm item delete");
    }

    return ACP.t(strings, "deleteTypedTitle", "Type DELETE to confirm permanent delete");
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
      '<span class="acp-modal-stat is-safe">' + ACP.escapeHtml(ACP.t(strings, "deleteSafeLabel", "Ready")) + ": " + ACP.escapeHtml(String(safeCount)) + "</span>"
    ];

    if (reviewCount > 0) {
      html.push('<span class="acp-modal-stat is-review">' + ACP.escapeHtml(ACP.t(strings, "deleteReviewCountLabel", "Review")) + ": " + ACP.escapeHtml(String(reviewCount)) + "</span>");
    }

    html.push("</div>");

    if (reviewCount > 0) {
      html.push(
        '<div class="acp-modal-warning-box">' +
          '<strong>' + ACP.escapeHtml(ACP.t(strings, "deleteReviewLabel", "Review required")) + ".</strong> " +
          ACP.escapeHtml(ACP.t(strings, "deleteTypedMessage", "One or more selected folders sit outside the configured appdata sources.")) +
        "</div>"
      );
    }

    if (settings.showTypeHint) {
      var typeHint = ACP.t(strings, "deleteTypedHint", "Type DELETE to continue with this permanent delete.");

      if (context.deleteTargetLabelPlural === ACP.t(strings, "deleteDatasetPlural", "datasets")) {
        typeHint = ACP.t(strings, "destroyTypedHint", "Type DELETE to continue with this dataset destroy.");
      } else if (context.deleteTargetLabelPlural === ACP.t(strings, "deleteItemPlural", "items")) {
        typeHint = ACP.t(strings, "deleteMixedTypedHint", "Type DELETE to continue with this delete.");
      }

      html.push('<div class="acp-modal-hint">' + ACP.escapeHtml(typeHint) + "</div>");
    }

    html.push('<div class="acp-modal-panel">');
    html.push('<div class="acp-modal-panel-title">' + ACP.escapeHtml(context.listTitle) + "</div>");
    html.push('<ul class="acp-modal-list">');

    $.each(preview, function(_, row) {
      html.push('<li><code class="acp-modal-path">' + ACP.escapeHtml(row.displayPath || row.path || "") + "</code>");
      if (row.datasetName) {
        html.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "zfsDatasetLabel", "ZFS dataset")) + '</span><code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(row.datasetName) + "</code></div>");
      }
      if (row.zfsImpactSummary) {
        html.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "zfsDestroyImpactLabel", "Impact")) + '</span><span class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(row.zfsImpactSummary) + "</span></div>");
      }
      if ($.isArray(row.zfsChildDatasets) && row.zfsChildDatasets.length) {
        html.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "zfsChildDatasetsLabel", "Child datasets")) + '</span><code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(formatPreviewList(row.zfsChildDatasets, Number(row.zfsChildDatasetCount || row.zfsChildDatasets.length))) + "</code></div>");
      }
      if ($.isArray(row.zfsSnapshots) && row.zfsSnapshots.length) {
        html.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "zfsSnapshotsLabel", "Snapshots")) + '</span><code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(formatPreviewList(row.zfsSnapshots, Number(row.zfsSnapshotCount || row.zfsSnapshots.length))) + "</code></div>");
      }
      html.push("</li>");
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

    stats.push('<span class="acp-modal-stat is-review">' + ACP.escapeHtml(ACP.t(strings, "resultBlockedLabel", "Locked")) + ": " + ACP.escapeHtml(String(summary.blocked || 0)) + "</span>");
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

      if (result.datasetName) {
        destinationHtml +=
          '<div class="acp-modal-result-destination">' +
            '<span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "zfsDatasetLabel", "ZFS dataset")) + "</span>" +
            '<code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(result.datasetName) + "</code>" +
          "</div>";
      }

      if (result.datasetName && (result.recursive === true || result.recursive === false)) {
        destinationHtml +=
          '<div class="acp-modal-result-destination">' +
            '<span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "zfsRecursiveDestroyLabel", "Destroy mode")) + "</span>" +
            '<code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(result.recursive ? ACP.t(strings, "zfsRecursiveDestroyValue", "Recursive destroy") : ACP.t(strings, "zfsStandardDestroyValue", "Standard destroy")) + "</code>" +
          "</div>";
      }

      if (result.zfsImpactSummary) {
        destinationHtml +=
          '<div class="acp-modal-result-destination">' +
            '<span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "zfsDestroyImpactLabel", "Impact")) + "</span>" +
            '<span class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(result.zfsImpactSummary) + "</span>" +
          "</div>";
      }

      if ($.isArray(result.zfsChildDatasets) && result.zfsChildDatasets.length) {
        destinationHtml +=
          '<div class="acp-modal-result-destination">' +
            '<span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "zfsChildDatasetsLabel", "Child datasets")) + "</span>" +
            '<code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(result.zfsChildDatasets.join(", ")) + "</code>" +
          "</div>";
      }

      if ($.isArray(result.zfsSnapshots) && result.zfsSnapshots.length) {
        destinationHtml +=
          '<div class="acp-modal-result-destination">' +
            '<span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "zfsSnapshotsLabel", "Snapshots")) + "</span>" +
            '<code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(result.zfsSnapshots.join(", ")) + "</code>" +
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
    var selectedRows = getSelectedActionRows();

    if (!selectedRows.length) {
      swal(ACP.t(strings, "deleteEmptyTitle", "Nothing selected"), ACP.t(strings, "deleteEmptyMessage", "Select at least one ready row before continuing."), "warning");
      return;
    }

    runCandidateOperation(selectedRows, "preview_" + getPrimaryOperation());
  }

  function startPrimaryActionFlow() {
    var selectedRows = getSelectedActionRows();
    var reviewRows = $.grep(selectedRows, function(row) {
      return row.risk === "review";
    });
    var context = buildOperationContext(getPrimaryOperation(), selectedRows);
    var confirmButtonText = buildActionConfirmButtonText(context, selectedRows.length);

    if (!selectedRows.length) {
      swal(ACP.t(strings, "deleteEmptyTitle", "Nothing selected"), ACP.t(strings, "deleteEmptyMessage", "Select at least one ready row before continuing."), "warning");
      return;
    }

    if (context.baseOperation === "delete") {
      if (selectionIncludesZfsRows(selectedRows)) {
        setBusy(true);
        ACP.applyDeleteModalClass("");
        swal({
          title: ACP.t(strings, "deletePreviewLoadingTitle", "Preparing delete review"),
          text: ACP.t(strings, "deletePreviewLoadingMessage", "Checking the selected items and collecting any recursive ZFS delete details."),
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
          operation: "preview_delete"
        }).done(function(response) {
          var previewSummary = response.summary || { ready: 0, missing: 0, blocked: 0, errors: 0 };
          var previewResults = $.isArray(response.results) ? response.results : [];
          var hasWarnings = Number(previewSummary.blocked || 0) > 0 || Number(previewSummary.missing || 0) > 0 || Number(previewSummary.errors || 0) > 0;

          setBusy(false);

          if (hasWarnings) {
            swal({
              title: ACP.t(strings, "dryRunResultTitleWarning", "Dry run finished with warnings"),
              text: "",
              type: "warning",
              html: true
            });
            ACP.applyDeleteModalClass(
              "acp-delete-modal acp-delete-results-modal",
              buildOperationResultsHtml(previewSummary, previewResults, buildOperationContext("preview_delete", selectedRows))
            );
            return;
          }

          swal({
            title: getDeleteTypedTitle(context),
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
          ACP.applyDeleteModalClass("acp-delete-modal acp-delete-modal-review", buildOperationPreviewHtml(previewResults, context, {
            reviewCount: reviewRows.length,
            showTypeHint: true
          }));
        }).fail(function(xhr) {
          setBusy(false);
          swal(context.failureTitle, ACP.extractErrorMessage(xhr, ACP.t(strings, "deletePreviewFailedMessage", "The delete preview could not be prepared right now.")), "error");
        });
        return;
      }

      swal({
        title: getDeleteTypedTitle(context),
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
    var context = buildOperationContext(operation, selectedRows);

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
        applyLocalOperationResults(results);
      }

      if (response.quarantineSummary) {
        state.quarantine.summary = $.extend({ count: 0, sizeLabel: "0 B" }, response.quarantineSummary);
      }

      if (!context.preview && context.baseOperation === "quarantine") {
        state.quarantine.loaded = false;
      }

      swal({
        title: modalTitle,
        text: "",
        type: modalType,
        html: true
      });
      ACP.applyDeleteModalClass("acp-delete-modal acp-delete-results-modal", buildOperationResultsHtml(summary, results, context));
      renderAll();
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

  function findQuarantineEntries(entryIds) {
    var idsByKey = {};

    $.each($.isArray(entryIds) ? entryIds : [entryIds], function(_, entryId) {
      var entryKey = String(entryId || "");

      if (entryKey) {
        idsByKey[entryKey] = true;
      }
    });

    return $.grep(state.quarantine.entries || [], function(entry) {
      return !!idsByKey[String(entry.id || "")];
    });
  }

  function buildQuarantineActionConfirmHtml(entries, action) {
    var selectedEntries = $.isArray(entries) ? entries : [];
    var isRestore = action === "restore";
    var isBulk = selectedEntries.length !== 1;
    var title = isRestore
      ? ACP.t(strings, isBulk ? "quarantineRestoreConfirmManyMessage" : "quarantineRestoreConfirmMessage", isBulk ? "Restore the selected quarantined folders back to their original locations." : "Restore this quarantined folder back to its original location.")
      : ACP.t(strings, isBulk ? "quarantinePurgeConfirmManyMessage" : "quarantinePurgeConfirmMessage", isBulk ? "Permanently delete the selected quarantined folders." : "Permanently delete this quarantined folder.");
    var listTitle = isRestore
      ? ACP.t(strings, isBulk ? "quarantineRestoreListManyTitle" : "quarantineRestoreListTitle", isBulk ? "Folders to restore" : "Folder to restore")
      : ACP.t(strings, isBulk ? "quarantinePurgeListManyTitle" : "quarantinePurgeListTitle", isBulk ? "Folders to purge" : "Folder to purge");
    var html = [
      '<div class="acp-modal-summary">',
      '<div class="acp-modal-flag">' + ACP.escapeHtml(action === "restore" ? ACP.t(strings, "quarantineRestoreActionLabel", "Restore") : ACP.t(strings, "quarantinePurgeActionLabel", "Purge")) + "</div>",
      '<div class="acp-modal-copy">',
      '<div class="acp-modal-lead">' + ACP.escapeHtml(title) + "</div>",
      '<div class="acp-modal-subcopy">' + ACP.escapeHtml(buildQuarantineSelectionSummaryText(selectedEntries.length)) + "</div>",
      "</div>",
      '<div class="acp-modal-panel">',
      '<div class="acp-modal-panel-title">' + ACP.escapeHtml(listTitle) + "</div>",
      '<ul class="acp-modal-list">'
    ];

    $.each(selectedEntries, function(_, entry) {
      html.push('<li><code class="acp-modal-path">' + ACP.escapeHtml((entry && entry.sourcePath) || "") + "</code></li>");
    });

    html.push("</ul>");
    html.push("</div>");
    html.push("</div>");

    return html.join("");
  }

  function inspectQuarantineRestoreConflicts(entryIds, onComplete) {
    swal({
      title: ACP.t(strings, "quarantineRestoreCheckingTitle", "Checking restore paths"),
      text: ACP.t(strings, "quarantineRestoreCheckingMessage", "Checking whether the original restore paths are still available."),
      type: "info",
      showConfirmButton: false,
      allowEscapeKey: false,
      allowOutsideClick: false
    });

    apiPost({
      action: "inspectQuarantineRestore",
      entryIds: JSON.stringify(entryIds)
    }).done(function(response) {
      if (typeof onComplete === "function") {
        onComplete(response.preview || {});
      }
    }).fail(function(xhr) {
      var failureMessage = ACP.extractErrorMessage(xhr, ACP.t(strings, "quarantineManagerActionFailedMessage", "The quarantine manager action could not be completed right now."));

      if (xhr && xhr.status === 409) {
        swal({
          title: ACP.t(strings, "quarantineRestoreFailedTitle", "Restore failed"),
          text: failureMessage,
          type: "error"
        }, function() {
          reopenQuarantineManagerModal(true);
        });
        return;
      }

      swal(ACP.t(strings, "quarantineRestoreFailedTitle", "Restore failed"), failureMessage, "error");
    });
  }

  function buildRestoreConflictDialogHtml(preview) {
    var summary = preview && preview.summary ? preview.summary : {};
    var conflicts = $.isArray(preview && preview.conflicts) ? preview.conflicts : [];
    var readyCount = Number(summary.ready || 0);
    var conflictCount = Number(summary.conflicts || conflicts.length || 0);
    var html = [
      '<div class="acp-modal-summary">',
      '<div class="acp-modal-flag">' + ACP.escapeHtml(ACP.t(strings, "resultConflictLabel", "Conflict")) + "</div>",
      '<div class="acp-modal-copy">',
      '<div class="acp-modal-lead">' + ACP.escapeHtml(ACP.t(strings, "quarantineRestoreConflictLead", "One or more original restore paths already exist. Choose how to handle the conflicts.")) + "</div>",
      '<div class="acp-modal-subcopy">' + ACP.escapeHtml(conflictCount + " conflict" + (conflictCount === 1 ? "" : "s") + " found" + (readyCount > 0 ? ". " + readyCount + " selected folder" + (readyCount === 1 ? " can" : "s can") + " still restore normally." : ".")) + "</div>",
      "</div>",
      '<div class="acp-modal-panel">',
      '<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "quarantineRestoreConflictListTitle", "Conflicting restore paths")) + "</div>",
      '<ul class="acp-modal-list acp-modal-result-list">'
    ];

    $.each(conflicts, function(_, conflict) {
      var suggestedName = conflict.suggestedName || "";
      var parentPath = conflict.parentPath || "";
      var previewPath = parentPath && suggestedName ? parentPath + "/" + suggestedName : "";

      html.push('<li class="acp-modal-result">');
      html.push('<div class="acp-modal-result-head"><span class="acp-modal-stat is-review">' + ACP.escapeHtml(ACP.t(strings, "resultConflictLabel", "Conflict")) + '</span><code class="acp-modal-path">' + ACP.escapeHtml(conflict.sourcePath || "") + "</code></div>");
      html.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "quarantineRestoreConflictParentLabel", "Restore parent")) + '</span><code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(parentPath) + "</code></div>");
      html.push('<div class="acp-modal-result-destination"><label class="acp-modal-result-label" for="acp-restore-conflict-' + ACP.escapeHtml(conflict.id || String(_)) + '">' + ACP.escapeHtml(ACP.t(strings, "quarantineRestoreConflictNameLabel", "Edited restore name")) + '</label><input id="acp-restore-conflict-' + ACP.escapeHtml(conflict.id || String(_)) + '" class="acp-input acp-restore-conflict-name" type="text" value="' + ACP.escapeHtml(suggestedName) + '" data-entry-id="' + ACP.escapeHtml(conflict.id || "") + '" data-parent-path="' + ACP.escapeHtml(parentPath) + '" autocomplete="off" spellcheck="false" /></div>');
      html.push('<div class="acp-modal-subcopy acp-restore-conflict-hint">' + ACP.escapeHtml(ACP.t(strings, "quarantineRestoreConflictNameHint", "Edit only the restored folder name. The parent path stays fixed.")) + "</div>");
      html.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "quarantineRestoreConflictEditedLabel", "Edited restore path")) + '</span><code class="acp-modal-path acp-modal-path-secondary" data-role="restore-conflict-preview">' + ACP.escapeHtml(previewPath) + "</code></div>");
      if (conflict.suggestedPath) {
        html.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "quarantineRestoreConflictSuggestedLabel", "Suggested suffix restore")) + '</span><code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(conflict.suggestedPath) + "</code></div>");
      }
      if (conflict.destination) {
        html.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "quarantineLocationLabel", "Quarantine path")) + '</span><code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(conflict.destination) + "</code></div>");
      }
      html.push("</li>");
    });

    html.push("</ul></div>");
    html.push('<div class="acp-modal-copy">');
    html.push('<div class="acp-modal-subcopy">' + ACP.escapeHtml(ACP.t(strings, "quarantineRestoreConflictSkipMessage", "Conflicting folders will stay in quarantine and the other selected folders will restore normally.")) + "</div>");
    html.push('<div class="acp-modal-subcopy">' + ACP.escapeHtml(ACP.t(strings, "quarantineRestoreConflictSuffixMessage", "Conflicting folders will restore beside the existing folders using the edited names below.")) + "</div>");
    html.push('<div class="acp-modal-subcopy acp-restore-conflict-feedback" data-role="restore-conflict-feedback"></div>');
    html.push("</div>");
    html.push('<div class="acp-modal-inline-actions acp-restore-conflict-actions">');
    html.push('<button type="button" class="acp-button acp-button-secondary" data-action="resolve-restore-conflicts" data-conflict-mode="skip">' + ACP.escapeHtml(ACP.t(strings, "quarantineRestoreConflictSkipLabel", "Skip conflicts")) + "</button>");
    html.push('<button type="button" class="acp-button acp-button-primary" data-action="resolve-restore-conflicts" data-conflict-mode="custom">' + ACP.escapeHtml(ACP.t(strings, "quarantineRestoreConflictSuffixLabel", "Restore edited names")) + "</button>");
    html.push("</div>");
    html.push("</div>");

    return html.join("");
  }

  function setRestoreConflictFeedback(message) {
    var $feedback = $(".sweet-alert [data-role='restore-conflict-feedback']");

    if (!$feedback.length) {
      return;
    }

    $feedback.text(String(message || ""));
    $feedback.toggleClass("is-visible", !!$.trim(String(message || "")));
  }

  function updateRestoreConflictPreview($input) {
    var inputValue;
    var parentPath;
    var previewPath;
    var $preview;

    if (!$input || !$input.length) {
      return;
    }

    inputValue = $.trim(String($input.val() || ""));
    parentPath = String($input.data("parent-path") || "");
    previewPath = parentPath && inputValue ? parentPath + "/" + inputValue : "";
    $preview = $input.closest(".acp-modal-result").find("[data-role='restore-conflict-preview']").first();

    if ($preview.length) {
      $preview.text(previewPath);
    }
  }

  function collectRestoreConflictNames() {
    var names = {};
    var invalidMessage = ACP.t(strings, "quarantineRestoreConflictInvalidMessage", "Enter a restore name for every conflicting folder. Names cannot contain slashes.");
    var isInvalid = false;
    var $firstInvalid = $();

    setRestoreConflictFeedback("");
    $(".sweet-alert .acp-restore-conflict-name").removeClass("is-error");

    $(".sweet-alert .acp-restore-conflict-name").each(function() {
      var $input = $(this);
      var entryId = String($input.data("entry-id") || "");
      var restoreName = $.trim(String($input.val() || ""));

      if (!entryId) {
        return;
      }

      if (!restoreName || restoreName === "." || restoreName === ".." || /[\\/]/.test(restoreName)) {
        if (!isInvalid) {
          isInvalid = true;
          $firstInvalid = $input;
        }
        $input.addClass("is-error");
        return;
      }

      names[entryId] = restoreName;
    });

    if (isInvalid) {
      setRestoreConflictFeedback(invalidMessage);
      if ($firstInvalid.length) {
        $firstInvalid.trigger("focus");
      }
      return null;
    }

    return names;
  }

  function openRestoreConflictDialog(entryIds, preview) {
    state.quarantine.restoreConflict = {
      entryIds: $.map(entryIds || [], function(entryId) {
        return String(entryId || "");
      }),
      preview: preview || {}
    };

    swal({
      title: ACP.t(strings, "quarantineRestoreConflictTitle", "Restore conflicts found"),
      text: "",
      type: "warning",
      html: true,
      showCancelButton: false,
      closeOnConfirm: true,
      confirmButtonText: ACP.t(strings, "quarantineRestoreConflictReviewLabel", "Review conflict")
    }, function() {
      state.quarantine.restoreConflict = null;
      reopenQuarantineManagerModal(false);
    });
    ACP.applyDeleteModalClass("acp-delete-modal acp-delete-results-modal", buildRestoreConflictDialogHtml(preview));
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
      var showPrimaryDestination = !!result.destination && !(result.quarantinePath && (result.status === "conflict" || result.status === "skipped"));
      html.push('<li class="acp-modal-result">');
      html.push('<div class="acp-modal-result-head"><span class="acp-modal-stat ' + ACP.escapeHtml(statusMeta.tone) + '">' + ACP.escapeHtml(statusMeta.label) + "</span><code class=\"acp-modal-path\">" + ACP.escapeHtml(result.sourcePath || result.destination || "") + "</code></div>");
      if (showPrimaryDestination) {
        html.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "destinationLabel", "Destination")) + '</span><code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(result.destination) + "</code></div>");
      }
      if (result.requestedRestorePath) {
        html.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "quarantineRestoreConflictEditedLabel", "Edited restore path")) + '</span><code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(result.requestedRestorePath) + "</code></div>");
      }
      if (result.suggestedPath) {
        html.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "quarantineRestoreConflictSuggestedLabel", "Suggested suffix restore")) + '</span><code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(result.suggestedPath) + "</code></div>");
      }
      if (result.quarantinePath) {
        html.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "quarantineLocationLabel", "Quarantine path")) + '</span><code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(result.quarantinePath) + "</code></div>");
      }
      if (result.message) {
        html.push('<div class="acp-modal-result-message">' + ACP.escapeHtml(result.message) + "</div>");
      }
      html.push("</li>");
    });

    html.push("</ul></div></div>");
    return html.join("");
  }

  function startQuarantineManagerActionFlow(action, entryIds) {
    var requestedEntryIds = $.map($.isArray(entryIds) ? entryIds : [entryIds], function(entryId) {
      var entryKey = String(entryId || "");
      return entryKey ? entryKey : null;
    });
    var entries = findQuarantineEntries(requestedEntryIds);
    var isRestore = action === "restore";
    var isBulk = requestedEntryIds.length !== 1;
    var confirmTitle = isRestore
      ? ACP.t(strings, isBulk ? "quarantineRestoreConfirmManyTitle" : "quarantineRestoreConfirmTitle", isBulk ? "Restore selected quarantined folders?" : "Restore quarantined folder?")
      : ACP.t(strings, isBulk ? "quarantinePurgeConfirmManyTitle" : "quarantinePurgeConfirmTitle", isBulk ? "Purge selected quarantined folders?" : "Purge quarantined folder?");
    var confirmButton = isRestore
      ? ACP.t(strings, "quarantineRestoreActionLabel", "Restore")
      : ACP.t(strings, "quarantinePurgeActionLabel", "Purge");

    if (!requestedEntryIds.length) {
      swal(
        ACP.t(strings, "deleteEmptyTitle", "Nothing selected"),
        ACP.t(strings, "quarantineManagerSelectionEmptyMessage", "Select at least one quarantined folder before continuing."),
        "warning"
      );
      return;
    }

    if (!entries.length) {
      openQuarantineManagerModal(true);
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

        runQuarantineManagerAction(requestedEntryIds, action);
        return true;
      });
      ACP.applyDeleteModalClass("acp-delete-modal acp-delete-modal-review", buildQuarantineActionConfirmHtml(entries, action));
      return;
    }

    inspectQuarantineRestoreConflicts(requestedEntryIds, function(preview) {
      var conflictCount = Number((preview && preview.summary && preview.summary.conflicts) || 0);

      if (conflictCount > 0) {
        openRestoreConflictDialog(requestedEntryIds, preview);
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
        runQuarantineManagerAction(requestedEntryIds, action);
      });
      ACP.applyDeleteModalClass("acp-delete-modal", buildQuarantineActionConfirmHtml(entries, action));
    });
  }

  function runQuarantineManagerAction(entryIds, action, options) {
    var isRestore = action === "restore";
    var requestOptions = $.extend({
      restoreConflictMode: "",
      restoreConflictNames: {}
    }, options || {});
    var loadingTitle = isRestore
      ? ACP.t(strings, "quarantineRestoreLoadingTitle", "Restoring quarantined folders")
      : ACP.t(strings, "quarantinePurgeLoadingTitle", "Purging quarantined folders");
    var loadingMessage = isRestore
      ? ACP.t(strings, "quarantineRestoreLoadingMessage", "Moving selected folders back to their original locations.")
      : ACP.t(strings, "quarantinePurgeLoadingMessage", "Permanently deleting selected quarantined folders.");
    var failureTitle = isRestore
      ? ACP.t(strings, "quarantineRestoreFailedTitle", "Restore failed")
      : ACP.t(strings, "quarantinePurgeFailedTitle", "Purge failed");

    state.quarantine.restoreConflict = null;
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
      entryIds: JSON.stringify(entryIds),
      scanToken: state.scanToken,
      restoreConflictMode: requestOptions.restoreConflictMode,
      restoreConflictNames: JSON.stringify(requestOptions.restoreConflictNames || {})
    }).done(function(response) {
      var quarantine = response.quarantine || {};
      var summary = response.summary || { restored: 0, purged: 0, skipped: 0, conflicts: 0, missing: 0, blocked: 0, errors: 0 };
      var results = $.isArray(response.results) ? response.results : [];
      var hasWarnings = Number(summary.skipped || 0) > 0 || Number(summary.conflicts || 0) > 0 || Number(summary.blocked || 0) > 0 || Number(summary.missing || 0) > 0 || Number(summary.errors || 0) > 0;
      var successTitle = isRestore
        ? ACP.t(strings, "quarantineRestoreSuccessTitle", "Restore complete")
        : ACP.t(strings, "quarantinePurgeSuccessTitle", "Purge complete");
      var warningTitle = isRestore
        ? ACP.t(strings, "quarantineRestoreWarningTitle", "Restore finished with warnings")
        : ACP.t(strings, "quarantinePurgeWarningTitle", "Purge finished with warnings");

      setQuarantineEntries(quarantine.entries, quarantine.summary);
      state.quarantine.loaded = true;
      state.quarantine.loading = false;
      if (Object.prototype.hasOwnProperty.call(response, "scanToken")) {
        state.scanToken = String(response.scanToken || "");
      }
      if (isRestore) {
        applyRestoredRows(results);
      }
      setBusy(false);
      renderAll();

      swal({
        title: hasWarnings ? warningTitle : successTitle,
        text: "",
        type: hasWarnings ? "warning" : "success",
        html: true
      }, function() {
        window.setTimeout(function() {
          ACP.releaseModalScrollLock(false);
          renderPanels();
        }, 180);
      });
      ACP.applyDeleteModalClass("acp-delete-modal acp-delete-results-modal", buildQuarantineManagerResultsHtml(action, summary, results));
    }).fail(function(xhr) {
      state.quarantine.loading = false;
      setBusy(false);
      renderPanels();

      if (xhr && xhr.status === 409) {
        swal({
          title: failureTitle,
          text: ACP.extractErrorMessage(xhr, ACP.t(strings, "quarantineManagerActionFailedMessage", "The quarantine manager action could not be completed right now.")),
          type: "error"
        }, function() {
          reopenQuarantineManagerModal(true);
        });
        return;
      }

      swal(failureTitle, ACP.extractErrorMessage(xhr, ACP.t(strings, "quarantineManagerActionFailedMessage", "The quarantine manager action could not be completed right now.")), "error");
    });
  }
})(window, document, jQuery);
