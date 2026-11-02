(function(window, document, $) {
  "use strict";

  var ACP = window.AppdataCleanupPlus = window.AppdataCleanupPlus || {};
  var config = window.appdataCleanupPlusConfig || {};
  var strings = config.strings || {};
  var actionBarResizeObserver = null;
  var auroraHeaderObserver = null;
  var summaryInfoHideTimer = null;
  var summaryInfoPinnedId = "";
  var selectedRowFeedback = { rowId: "", expiresAt: 0, timer: null };
  var fixtureToolsRequestVersion = 0;
  var fixtureToolsPendingAction = "";
  var diagnosticsExportState = {loading: false, result: "idle", summary: null};
  var diagnosticsActivity = [];
  var diagnosticsActivityTotal = 0;
  var diagnosticsRequestSerial = 0;
  var diagnosticsActivityStartedAt = new Date().toISOString();
  var diagnosticsActivityClock = Date.now();
  var diagnosticsLastModal = "none";
  var diagnosticsExportRedactor = null;
  var state = {
    rows: [],
    summary: { total: 0, deletable: 0, review: 0, blocked: 0, ignored: 0 },
    showIgnored: false,
    selected: {},
    scanToken: "",
    dockerRunning: true,
    auditHistory: [],
    auditHistoryLoading: false,
    auditHistoryLoaded: false,
    auditHistoryHasMore: false,
    auditHistoryRequestToken: "",
    auditQuery: "",
    auditOpen: false,
    fixtureTools: {
      loading: false,
      ok: null,
      message: "",
      status: null
    },
    templateManager: { loading: false, status: null, message: "", selected: null },
    deferredDataRequestToken: "",
    scanWarningMessage: "",
    scanVerification: "not_checked",
    scanMetrics: {},
    settings: ACP.defaultSafetySettings(),
    appdataSources: {
      detected: [],
      manual: [],
      effective: [],
      zfsPathMappings: [],
      zfsPathMappingSuggestions: []
    },
    appdataSourceBrowser: defaultAppdataSourceBrowserState(),
    zfsPathMappingBrowser: defaultZfsPathMappingBrowserState(),
    rowDetails: {
      activeRowId: "",
      requestToken: "",
      cache: {}
    },
    quarantine: {
      loading: false,
      loaded: false,
      entries: [],
      selected: {},
      summary: { count: 0, sizeLabel: "0 B" },
      summaryRequestToken: "",
      purgeAtInput: "",
      restoreConflict: null
    },
    scanHydration: {
      active: false,
      queue: [],
      batchSize: 8,
      requestToken: ""
    },
    operationProgress: {
      activeId: "",
      pollTimer: null,
      pendingResult: null,
      latest: null
    },
    recovery: { operations: [], activeId: "", pollTimer: null, requestToken: "", terminal: false, openedAt: 0 },
    sortMode: "name",
    bulkSelectPreset: "safe",
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

  function buildBulkSelectionPresetDefinitions() {
    var olderThanCutoff = Math.floor(Date.now() / 1000) - (90 * 24 * 60 * 60);

    return [
      {
        value: "safe",
        label: ACP.t(strings, "selectionPresetSafeLabel", "Ready rows"),
        matches: function(row) {
          return isRowSelectable(row) && getRowActionabilityDescriptor(row).value === "ready";
        }
      },
      {
        value: "discovery",
        label: ACP.t(strings, "selectionPresetDiscoveryLabel", "Discovery only"),
        matches: function(row) {
          return isRowSelectable(row) && String((row && row.sourceKind) || "") === "filesystem";
        }
      },
      {
        value: "zfs",
        label: ACP.t(strings, "selectionPresetZfsLabel", "ZFS-backed"),
        matches: function(row) {
          return isRowSelectable(row) && String((row && row.storageKind) || "") === "zfs";
        }
      },
      {
        value: "older90",
        label: ACP.t(strings, "selectionPresetOlderLabel", "Older than 90 days"),
        matches: function(row) {
          return isRowSelectable(row) && Number((row && row.lastModified) || 0) > 0 && Number(row.lastModified) <= olderThanCutoff;
        }
      }
    ];
  }

  function getBulkSelectionPresetDefinition(value) {
    var presetValue = $.trim(String(value || ""));
    var matches = $.grep(buildBulkSelectionPresetDefinitions(), function(definition) {
      return String((definition && definition.value) || "") === presetValue;
    });

    return matches.length ? matches[0] : null;
  }

  function getRowsForBulkSelectionPreset(value) {
    var definition = getBulkSelectionPresetDefinition(value);

    if (!definition || typeof definition.matches !== "function") {
      return [];
    }

    return $.grep(state.rows || [], function(row) {
      return definition.matches(row);
    });
  }

  function syncBulkSelectionPresetControls() {
    var html = [];
    var presetValue = getBulkSelectionPresetDefinition(state.bulkSelectPreset) ? state.bulkSelectPreset : "safe";

    state.bulkSelectPreset = presetValue;

    $.each(buildBulkSelectionPresetDefinitions(), function(_, definition) {
      html.push('<option value="' + ACP.escapeHtml(String(definition.value || "")) + '">' + ACP.escapeHtml(String(definition.label || "")) + "</option>");
    });

    if (els.$selectPreset && els.$selectPreset.length) {
      els.$selectPreset.html(html.join(""));
      els.$selectPreset.val(presetValue);
      els.$selectPreset.prop("disabled", state.busy || !(state.rows || []).length);
    }

    if (els.$applySelectPreset && els.$applySelectPreset.length) {
      els.$applySelectPreset.prop("disabled", state.busy || !(state.rows || []).length);
    }
  }

  function applyBulkSelectionPreset(value) {
    var matchingRows = getRowsForBulkSelectionPreset(value);

    state.selected = {};

    $.each(matchingRows, function(_, row) {
      if (row && row.id) {
        state.selected[row.id] = true;
      }
    });

    renderResults();
    renderSummaryCards();
    updateActionBar();

    if (!matchingRows.length && value) {
      swal(
        ACP.t(strings, "selectionPresetEmptyTitle", "Nothing matched"),
        ACP.t(strings, "selectionPresetEmptyMessage", "No selectable rows matched that preset in the current scan."),
        "warning"
      );
    }
  }

  function init() {
    installDiagnosticsErrorCapture();
    cacheElements();
    installActionBarLayout();
    ACP.applyThemeState(els.$app);
    installAuroraHeaderSync();
    ACP.watchThemeChanges(function() {
      ACP.applyThemeState(els.$app);
      ACP.syncDeleteModalThemeTokens($(".sweet-alert"));
      syncAuroraHeader();
    });
    bindEvents();
    renderSummaryCards();
    renderPanels();
    renderLoadingState();
    updateActionBar();
    loadScan();
    loadRecentOperations();
  }

  function cacheElements() {
    els.$app = $("#acp-app");
    els.$summaryCards = $("#acp-summary-cards");
    els.$search = $("#acp-search");
    els.$help = $("#acp-help");
    els.$sort = $("#acp-sort");
    els.$rescan = $("#acp-rescan");
    els.$selectVisible = $("#acp-select-visible");
    els.$clearSelection = $("#acp-clear-selection");
    els.$selectPreset = $("#acp-select-preset");
    els.$applySelectPreset = $("#acp-apply-select-preset");
    els.$selectAll = $("#acp-select-all");
    els.$dryRun = $("#acp-dry-run");
    els.$primaryAction = $("#acp-primary-action");
    els.$modeStrip = $("#acp-mode-strip");
    els.$resultsContext = $("#acp-results-context-row");
    els.$notices = $("#acp-notices");
    els.$actionToolbar = $("#acp-action-toolbar");
    els.$results = $("#acp-results");
    els.$selectionSummary = $("#acp-selection-summary");
    els.$selectionDetail = $("#acp-selection-detail");
    els.$bottomBar = $("#acp-bottom-bar");
  }

  function syncActionBarLayout() {
    if (!els.$bottomBar || !els.$bottomBar.length || !els.$app || !els.$app.length) {
      return;
    }

    var bar = els.$bottomBar[0];
    var style = window.getComputedStyle(bar);
    var clearance = style.position === "fixed" && style.display !== "none"
      ? Math.ceil(bar.getBoundingClientRect().height + (parseFloat(style.bottom) || 0) + 16)
      : 16;
    els.$app[0].style.setProperty("--acp-bottom-clearance", clearance + "px");
  }

  function installActionBarLayout() {
    $(window).off("resize.acpActionBarLayout").on("resize.acpActionBarLayout", syncActionBarLayout);
    if (actionBarResizeObserver) {
      actionBarResizeObserver.disconnect();
    }
    if (typeof window.ResizeObserver === "function" && els.$bottomBar && els.$bottomBar.length) {
      actionBarResizeObserver = new window.ResizeObserver(syncActionBarLayout);
      actionBarResizeObserver.observe(els.$bottomBar[0]);
    }
    syncActionBarLayout();
  }

  function syncAuroraHeader() {
    var box = document.getElementById("displaybox");
    var app = document.getElementById("acp-app");
    if (!box) return;
    var active = !!app && box.contains(app) && document.documentElement.classList.contains("tp-enhance") && Array.prototype.some.call(document.querySelectorAll("script[src]"), function(script) {
      try {
        var url = new URL(script.getAttribute("src"), document.baseURI);
        return url.origin === window.location.origin && /^\/plugins\/Aurora-Theme\/scripts\/enhance(?:-\d+)?\.js$/.test(url.pathname);
      } catch (_error) { return false; }
    });
    var controls = 'a, button, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
    Array.prototype.forEach.call(box.children, function(heading) {
      if (!heading.classList.contains("tp-heading")) return;
      var text = Array.prototype.filter.call(heading.children, function(child) { return child.classList.contains("tp-heading-text"); })[0];
      [heading, text].forEach(function(node) {
        if (!node) return;
        if (active && text && text.querySelector("h1") && !node.matches(controls) && !node.querySelector(controls)) node.setAttribute("data-acp-aurora-duplicate", "true");
        else node.removeAttribute("data-acp-aurora-duplicate");
      });
    });
  }

  function installAuroraHeaderSync() {
    if (auroraHeaderObserver) auroraHeaderObserver.disconnect();
    syncAuroraHeader();
    var box = document.getElementById("displaybox");
    if (!box || typeof window.MutationObserver !== "function") return;
    auroraHeaderObserver = new window.MutationObserver(function(records) {
      if (records.some(function(record) {
        return record.target === box || (record.target.nodeType === 1 && record.target.closest(".tp-heading"));
      })) syncAuroraHeader();
    });
    auroraHeaderObserver.observe(box, {childList: true, subtree: true});
  }

  function closeSummaryInfo() {
    window.clearTimeout(summaryInfoHideTimer);
    summaryInfoHideTimer = null;
    summaryInfoPinnedId = "";
    if (!els.$summaryCards) return;
    els.$summaryCards.find(".acp-summary-tooltip").prop("hidden", true);
    els.$summaryCards.find(".acp-summary-info").attr("aria-expanded", "false");
  }

  function showSummaryInfo(button, pinned) {
    var id = button.getAttribute("aria-describedby");
    var tooltip = document.getElementById(id);
    if (!tooltip) return;
    closeSummaryInfo();
    summaryInfoPinnedId = pinned ? id : "";
    button.setAttribute("aria-expanded", "true");
    tooltip.hidden = false;
    var bounds = button.getBoundingClientRect();
    var size = tooltip.getBoundingClientRect();
    var gap = 8;
    var left = Math.max(12, Math.min(bounds.right - size.width, window.innerWidth - size.width - 12));
    var top = bounds.bottom + gap;
    if (top + size.height > window.innerHeight - 12) top = Math.max(12, bounds.top - size.height - gap);
    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
  }

  function scheduleSummaryInfoClose() {
    window.clearTimeout(summaryInfoHideTimer);
    summaryInfoHideTimer = window.setTimeout(function() {
      if (summaryInfoPinnedId) return;
      var active = document.activeElement;
      if (active && active.classList.contains("acp-summary-info")) return;
      if (els.$summaryCards.find(".acp-summary-info:hover, .acp-summary-tooltip:hover").length) return;
      closeSummaryInfo();
    }, 150);
  }

  function bindEvents() {
    els.$summaryCards.on("mouseenter.acpSummaryInfo focusin.acpSummaryInfo", ".acp-summary-info", function() {
      if (summaryInfoPinnedId !== this.getAttribute("aria-describedby")) showSummaryInfo(this, false);
    }).on("mouseleave.acpSummaryInfo focusout.acpSummaryInfo", ".acp-summary-info", scheduleSummaryInfoClose)
      .on("mouseenter.acpSummaryInfo", ".acp-summary-tooltip", function() { window.clearTimeout(summaryInfoHideTimer); })
      .on("mouseleave.acpSummaryInfo", ".acp-summary-tooltip", scheduleSummaryInfoClose)
      .on("click.acpSummaryInfo", ".acp-summary-info", function() {
        var id = this.getAttribute("aria-describedby");
        if (summaryInfoPinnedId === id) closeSummaryInfo();
        else showSummaryInfo(this, true);
      });
    $(document).on("keydown.acpSummaryInfo", function(event) {
      if (event.key === "Escape") closeSummaryInfo();
    }).on("click.acpSummaryInfo", function(event) {
      if (!$(event.target).closest(".acp-summary-info, .acp-summary-tooltip").length) closeSummaryInfo();
    });
    $(window).on("resize.acpSummaryInfo scroll.acpSummaryInfo", closeSummaryInfo);
    els.$app.on("click", "[data-action='review-recent-operation']", function() {
      openRecoveredOperation($(this).attr("data-operation-id"));
    });
    $(document).on("click.acpRecovery", ".sweet-alert [data-action='dismiss-operation']", function() {
      var id = $(this).attr("data-operation-id");
      $(this).prop("disabled", true);
      apiPost({action: "acknowledgeOperation", operationProgressId: id}).done(function() {
        if (state.recovery.activeId === id) {
          state.recovery.activeId = "";
          if (typeof swal.close === "function") swal.close();
          ACP.releaseModalScrollLock(false);
        }
        loadRecentOperations();
        loadScan();
      }).fail(function() { loadRecoveredOperation(id); });
    });
    els.$search.on("input", renderAll);

    els.$sort.on("change", function() {
      state.sortMode = els.$sort.val();
      renderResults();
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

    els.$help.on("click", function() {
      if (!state.busy) {
        openHelpModal();
      }
    });

    els.$results.on("click", ".acp-row", function(event) {
      if ($(event.target).closest(".acp-row-checkbox, .acp-button, .acp-mount-evidence, a, button, input, select, textarea").length) {
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

      if (action === "details") {
        openRowDetailsModal(findRowById(rowId));
        return;
      }

      postRowAction(action, rowId);
    });

    els.$selectPreset.on("change", function() {
      state.bulkSelectPreset = $.trim(String(els.$selectPreset.val() || ""));
      syncBulkSelectionPresetControls();
    });

    els.$applySelectPreset.on("click", function() {
      if (!state.busy) {
        applyBulkSelectionPreset(state.bulkSelectPreset);
      }
    });

    els.$results.on("click", "[data-action]", function() {
      var action = $(this).data("action");

      if (action === "rescan") {
        loadScan();
      }
    });

    els.$app.on("click", "[data-action='toggle-quarantine']", function() {
      if (!state.busy) {
        openQuarantineManagerModal(false);
      }
    });

    els.$app.on("click", "[data-action='open-appdata-sources']", function() {
      if (!state.busy) {
        openAppdataSourcesModal();
      }
    });

    $(document).on("click.acpHelpLinks", ".sweet-alert.acp-help-modal [data-action='help-open-sources'], .sweet-alert.acp-help-modal [data-action='help-open-tools']", function(event) {
      event.preventDefault();
      event.stopPropagation();
      if (state.busy) return;
      if ($(this).attr("data-action") === "help-open-sources") openAppdataSourcesModal();
      else openToolsModal();
    });

    els.$app.on("click", "[data-action='toggle-safe-mode']", function() {
      if (!state.busy) {
        saveSafetySettings({
          enablePermanentDelete: !state.settings.enablePermanentDelete
        });
      }
    });

    $(document).on("click.acpZfsMappings", "#acp-app [data-action='open-zfs-path-mappings'], .sweet-alert [data-action='open-zfs-path-mappings']", function() {
      if (!state.busy) {
        openZfsPathMappingsModal();
      }
    });

    els.$app.on("click", "[data-action='open-audit-history']", function() {
      if (!state.busy) {
        openAuditHistoryModal();
      }
    });

    els.$app.on("click", "[data-action='open-template-manager']", function() {
      if (!state.busy) {
        ensureTemplateManagerModal();
        renderTemplateManagerModal();
        if (!state.templateManager.loading) runTemplateManagerAction("status", "");
      }
    });

    els.$app.on("click", "[data-action='open-tools']", function() {
      if (!state.busy) {
        openToolsModal();
      }
    });

    els.$app.on("click", "[data-action='review-container-mounts']", function() {
      if (state.busy) return;
      var row = $.grep(state.rows || [], function(candidate) {
        return (candidate.mountEvidence || []).length > 0;
      })[0];
      if (row) openRowDetailsModal(row);
      else openHelpModal();
    });

    els.$app.on("click", "[data-action='toggle-ignored-visibility']", function() {
      state.showIgnored = !state.showIgnored;
      reconcileSelection();
      renderAll();
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


    $(document).on("click.acpTemplates", ".sweet-alert [data-action='review-templates'], .sweet-alert [data-action='archive-template'], .sweet-alert [data-action='restore-template']", function(event) {
      event.preventDefault();
      if (state.busy || state.templateManager.loading) return;
      var action = $(this).attr("data-action");
      var id = $(this).attr("data-template-id") || "";
      if (action === "review-templates") { runTemplateManagerAction("status", ""); return; }
      var operation = action === "archive-template" ? "archive" : "restore";
      swal({
        title: operation === "archive" ? ACP.tr("Archive this saved template?") : ACP.tr("Restore this saved template?"),
        text: operation === "archive" ? ACP.tr("The saved container configuration will be backed up before removal. Appdata, images, and containers will not change.") : ACP.tr("The backup will be restored only if no template with the same filename exists."),
        type: "warning", showCancelButton: true, closeOnConfirm: false,
        confirmButtonText: operation === "archive" ? ACP.tr("Archive template") : ACP.tr("Restore template"),
        cancelButtonText: ACP.tr("Cancel")
      }, function(confirmed) {
        getActiveSweetAlertModal().removeClass("acp-template-manager-modal");
        ensureTemplateManagerModal();
        if (confirmed) runTemplateManagerAction(operation, id);
        else renderTemplateManagerModal();
      });
    });
    $(document).on("change.acpBackup", ".sweet-alert [data-action='select-template-backup'], .sweet-alert [data-action='select-template-backup-batch']", function() {
      if (state.busy || state.templateManager.loading) return;
      var action = $(this).attr("data-action"), backupId = $(this).attr("data-backup-id");
      var $modal = getActiveSweetAlertModal();
      var hostScroll = $modal.find(".acp-modal-host").scrollTop(), listScroll = $modal.find(".acp-template-list").scrollTop();
      var ids = ACP.selectedTemplateBackupIds(state.templateManager);
      var selected = {};
      if (action === "select-template-backup-batch") {
        if ($(this).val() === "") return;
        var start = Number($(this).val());
        ids = $.map(((state.templateManager.status || {}).backups || []).slice(start, start + 50), function(row) { return row.id; });
      } else {
        var id = $(this).attr("data-backup-id");
        ids = $.grep(ids, function(value) { return value !== id; });
        if (this.checked && ids.length >= 50) {
          this.checked = false;
          state.templateManager.message = ACP.tr("Select up to 50 backups for export or removal.");
        } else if (this.checked) ids.push(id);
      }
      $.each(ids, function(_, id) { selected[id] = true; });
      state.templateManager.selected = selected;
      renderTemplateManagerModal();
      $modal.find("[data-action]").filter(function() { return $(this).attr("data-action") === action && $(this).attr("data-backup-id") === backupId; }).first().trigger("focus");
      $modal.find(".acp-modal-host").scrollTop(hostScroll);
      $modal.find(".acp-template-list").scrollTop(listScroll);
    });
    $(document).on("click.acpBackup", ".sweet-alert [data-action='export-template-backups'], .sweet-alert [data-action='import-template-backups'], .sweet-alert [data-action='remove-template-backups'], .sweet-alert [data-action='clear-template-backup-selection']", function(event) {
      event.preventDefault();
      if (state.busy || state.templateManager.loading) return;
      var action = $(this).attr("data-action");
      if (action === "clear-template-backup-selection") { state.templateManager.selected = {}; renderTemplateManagerModal(); return; }
      if (action === "import-template-backups") { $("#acp-template-backup-file").val("").trigger("click"); return; }
      var backupId = $(this).attr("data-backup-id");
      var ids = backupId ? [backupId] : ACP.selectedTemplateBackupIds(state.templateManager);
      if (!ids.length) return;
      if (action === "export-template-backups") { runTemplateManagerAction("export", "", {backupIds: JSON.stringify(ids)}); return; }
      swal({title: ACP.tr("Remove template backups"), text: "", type: "warning", html: true,
        showCancelButton: true, closeOnConfirm: false, confirmButtonText: ACP.tr("Remove template backups"), cancelButtonText: ACP.tr("Cancel")}, function(confirmed) {
        if (confirmed && !requireDeleteConfirmationChecked()) return false;
        getActiveSweetAlertModal().removeClass("acp-template-manager-modal");
        ensureTemplateManagerModal();
        if (confirmed) runTemplateManagerAction("remove-backups", "", {backupIds: JSON.stringify(ids), backupRemovalConfirmed: "yes"});
        else renderTemplateManagerModal();
      });
      var backupNames = $.grep(((state.templateManager.status || {}).backups || []), function(record) { return $.inArray(record.id, ids) !== -1; });
      var backupList = '<ul>' + $.map(backupNames, function(record) { return '<li><code class="acp-modal-path">' + ACP.escapeHtml(record.filename) + '</code></li>'; }).join("") + '</ul>';
      ACP.applyDeleteModalClass("acp-delete-modal", '<p>' + ACP.escapeHtml(ACP.tr("This permanently removes the listed recovery backups. Export them first if needed. Saved templates and appdata will not change.")) + '</p>' + backupList + buildDeleteConfirmationHtml(ACP.tr("I understand these template backups will be permanently removed.")));
      syncDeleteConfirmationState();
    });
    $(document).on("change.acpBackup", "#acp-template-backup-file", function() {
      if (state.busy || state.templateManager.loading) return;
      var file = this.files && this.files[0];
      if (!file) return;
      if (file.size > 16777216) { state.templateManager.message = ACP.tr("Backup import was refused. Check the file format, integrity, and size limits."); renderTemplateManagerModal(); return; }
      var reader = new window.FileReader();
      state.templateManager.loading = true;
      reader.onload = function() {
        state.templateManager.loading = false;
        if (!isTemplateManagerModalVisible()) return;
        runTemplateManagerAction("import", "", {backupJson: String(reader.result || "")});
      };
      reader.onerror = function() {
        state.templateManager.loading = false;
        state.templateManager.message = ACP.tr("Backup import was refused. Check the file format, integrity, and size limits.");
        if (isTemplateManagerModalVisible()) renderTemplateManagerModal();
      };
      renderTemplateManagerModal();
      reader.readAsText(file);
    });
    $(document).on("click.acpMounts", ".acp-mount-evidence", function(event) { event.stopPropagation(); });
    $(document).on("keydown.acpMounts", ".acp-mount-evidence", function(event) {
      if (event.key === "Escape") { $(this).prop("open", false).find("summary").focus(); event.stopPropagation(); }
    });

    $(document).on("click.acpTools", ".sweet-alert [data-action='create-test-fixtures']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!state.busy && !state.fixtureTools.loading) {
        runFixtureManagerAction("create");
      }
    });

    $(document).on("click.acpTools", ".sweet-alert [data-action='remove-test-fixtures']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!state.busy && !state.fixtureTools.loading) {
        runFixtureManagerAction("remove");
      }
    });

    $(document).on("click.acpTools", ".sweet-alert [data-action='refresh-test-fixtures']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!state.busy && !state.fixtureTools.loading) {
        runFixtureManagerAction("status");
      }
    });

    $(document).on("input.acpAudit", ".sweet-alert .acp-audit-search", function() {
      state.auditQuery = String($(this).val() || "");
      if (state.auditOpen) {
        renderAuditHistoryModal();
        $(".sweet-alert .acp-audit-search").focus();
      }
    });

    $(document).on("click.acpAudit", ".sweet-alert [data-action='copy-audit-summary']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      copyAuditSummary();
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

    $(document).on("click.acpOperationProgress", ".sweet-alert [data-action='view-operation-results']", function(event) {
      event.preventDefault();
      event.stopPropagation();
      showPendingOperationResults();
    });

    $(document).on("change.acpDeleteConfirm", ".sweet-alert .acp-delete-confirm-checkbox", function() {
      syncDeleteConfirmationState();
    });

    $(document).on("click.acpRowDetails", ".sweet-alert [data-action='row-detail-select']", function(event) {
      var rowId = String($(this).data("row-id") || "");
      var row = findRowById(rowId);

      event.preventDefault();
      event.stopPropagation();

      if (!row || !isRowSelectable(row)) {
        return;
      }

      state.selected[rowId] = true;
      recordDiagnosticsActivity("selection_changed", {selectedCount:getSelectedRows().length});
      swal.close();
      state.rowDetails.activeRowId = "";
      state.rowDetails.requestToken = "";
      renderResults();
      renderSummaryCards();
      updateActionBar();
      revealSelectedRow(rowId);
    });

    $(document).on("click.acpRowDetails", ".sweet-alert [data-action='row-detail-ignore'], .sweet-alert [data-action='row-detail-restore']", function(event) {
      var rowId = String($(this).data("row-id") || "");
      var action = $(this).data("action") === "row-detail-restore" ? "unignore" : "ignore";

      event.preventDefault();
      event.stopPropagation();

      if (!rowId || state.busy) {
        return;
      }

      swal.close();
      state.rowDetails.activeRowId = "";
      state.rowDetails.requestToken = "";
      ACP.releaseModalScrollLock(false);
      postRowAction(action, rowId);
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

    $(document).on("click.acpZfsMappings", ".sweet-alert [data-action='use-zfs-path-mapping-suggestion']", function(event) {
      event.preventDefault();
      event.stopPropagation();

      if (!state.busy && !state.zfsPathMappingBrowser.loading) {
        applyZfsPathMappingSuggestion($(this).data("shareRoot"), $(this).data("datasetRoot"));
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

  function buildContext() {
    return {
      state: state,
      els: els,
      strings: strings,
      diagnosticsExport: diagnosticsExportState
    };
  }

  function apiPost(data) {
    var requestHeaders = {};
    var requestStarted = Date.now();
    var activityRequest = ++diagnosticsRequestSerial;
    recordDiagnosticsActivity("request_started", {action: data && data.action, request: activityRequest, fixtureAction: data && data.managerAction});

    if (config.csrfToken) {
      requestHeaders["X-Appdata-Cleanup-Plus-CSRF"] = String(config.csrfToken);
    }

    var request = $.ajax({
      url: config.apiUrl,
      method: "POST",
      dataType: "json",
      timeout: data && data.action === "getDiagnosticsBundle" ? 30000 :
        (data && /^(getOperationProgress|getRecentOperations|acknowledgeOperation)$/.test(data.action) ? 15000 : 0),
      converters: {"text json": function(text) { return ACP.localizePresentation(JSON.parse(text)); }},
      headers: requestHeaders,
      data: ACP.buildApiRequestData(config, data)
    });
    request.fail(function(xhr, status) {
      recordDiagnosticsActivity("request_failed", {action: data && data.action, request: activityRequest, httpStatus: xhr && xhr.status, durationMs: Date.now() - requestStarted});
      recordDiagnosticsFailure(data && data.action, xhr && xhr.status, status, Date.now() - requestStarted, data, xhr && xhr.responseJSON);
    });
    request.done(function(response) {
      recordDiagnosticsActivity(response && response.ok === false ? "request_failed" : "request_completed", {action: data && data.action, request: activityRequest, httpStatus: 200, durationMs: Date.now() - requestStarted});
      if (response && response.ok === false) recordDiagnosticsFailure(data && data.action, 200, "application", Date.now() - requestStarted, data, response);
    });
    return request;
  }

  function apiPostWithPluginBusyRetry(data, options) {
    var normalizedOptions = $.isPlainObject(options) ? options : {};
    var retriesRemaining = Math.max(0, Number(normalizedOptions.retries || 0));
    var deferred = $.Deferred();

    function attempt() {
      apiPost(data).done(function(response, textStatus, xhr) {
        deferred.resolveWith(this, [response, textStatus, xhr]);
      }).fail(function(xhr, textStatus, errorThrown) {
        if (isPluginBusyResponse(xhr) && retriesRemaining > 0) {
          retriesRemaining--;
          window.setTimeout(attempt, getRetryAfterDelayMs(xhr));
          return;
        }

        deferred.rejectWith(this, [xhr, textStatus, errorThrown]);
      });
    }

    attempt();
    return deferred.promise();
  }

  function apiPostForUserAction(data, options) {
    pauseScanStatHydrationForUserRequest();
    return apiPostWithPluginBusyRetry(data, $.extend({ retries: 2 }, $.isPlainObject(options) ? options : {}));
  }

  function isPluginBusyResponse(xhr) {
    return !!xhr && Number(xhr.status || 0) === 429;
  }

  function getRetryAfterDelayMs(xhr) {
    var retryAfter = xhr && typeof xhr.getResponseHeader === "function" ? Number(xhr.getResponseHeader("Retry-After") || 0) : 0;

    if (!retryAfter || retryAfter < 1) {
      retryAfter = 3;
    }

    return Math.max(1000, Math.min(10000, retryAfter * 1000));
  }

  function getPluginBusyMessage(xhr) {
    var retryAfter = xhr && typeof xhr.getResponseHeader === "function" ? Number(xhr.getResponseHeader("Retry-After") || 0) : 0;
    var fallback = ACP.t(strings, "backendBusyMessage", "Another Appdata Cleanup Plus operation is still running. Wait a few seconds, then try again.");
    var message = ACP.extractErrorMessage(xhr, fallback);

    if (retryAfter > 0 && message.indexOf("Retry after") === -1) {
      message += " " + ACP.plural("Retry after about {count} seconds.", retryAfter);
    }

    return message;
  }

  function syncSafetyControls() {
    state.settings = $.extend({}, ACP.defaultSafetySettings(), state.settings || {}, {
      enableZfsDatasetDelete: true
    });
  }

  function getPrimaryOperation() {
    return state.settings.enablePermanentDelete ? "delete" : "quarantine";
  }

  function getPrimaryActionLabel() {
    return state.settings.enablePermanentDelete
      ? ACP.t(strings, "deleteActionLabel", "Delete selected")
      : ACP.t(strings, "quarantineActionLabel", "Quarantine selected");
  }

  function isRowSelectable(row) {
    return !!row && !row.ignored && !!row.canDelete;
  }

  function isReadySelectableRow(row) {
    return isRowSelectable(row) && getRowActionabilityDescriptor(row).value === "ready";
  }

  function setBusy(isBusy) {
    state.busy = !!isBusy;
    els.$app.toggleClass("is-busy", state.busy);
    els.$rescan.prop("disabled", state.busy);
    els.$search.prop("disabled", state.busy);
    els.$help.prop("disabled", state.busy);
    els.$sort.prop("disabled", state.busy);
    syncBulkSelectionPresetControls();
    updateActionBar();
  }

  function resetDashboardState() {
    state.rows = [];
    state.summary = { total: 0, deletable: 0, review: 0, blocked: 0, ignored: 0 };
    state.showIgnored = false;
    state.selected = {};
    state.scanToken = "";
    state.dockerRunning = true;
    state.auditHistory = [];
    state.auditHistoryLoading = false;
    state.auditHistoryLoaded = false;
    state.auditHistoryHasMore = false;
    state.auditHistoryRequestToken = "";
    state.auditQuery = "";
    state.fixtureTools = { loading: false, ok: null, message: "", status: null };
    state.deferredDataRequestToken = "";
    state.scanWarningMessage = "";
    state.settings = ACP.defaultSafetySettings();
    state.appdataSources = { detected: [], manual: [], effective: [], zfsPathMappings: [], zfsPathMappingSuggestions: [] };
    state.appdataSourceBrowser = defaultAppdataSourceBrowserState();
    state.zfsPathMappingBrowser = defaultZfsPathMappingBrowserState();
    state.rowDetails = { activeRowId: "", requestToken: "", cache: {} };
    state.quarantine.entries = [];
    state.quarantine.loaded = false;
    state.quarantine.selected = {};
    state.quarantine.summary = { count: 0, sizeLabel: "0 B" };
    state.quarantine.summaryRequestToken = "";
    state.quarantine.purgeAtInput = "";
    state.quarantine.restoreConflict = null;
    state.scanHydration.active = false;
    state.scanHydration.queue = [];
    state.scanHydration.requestToken = "";
  }

  function loadScan() {
    var shouldHydrate = false;
    var deferredDataRequestToken = String(Date.now()) + ":" + String(Math.random());
    var previousBrowserState = $.extend(true, {}, state.appdataSourceBrowser || defaultAppdataSourceBrowserState());
    var previousZfsBrowserState = $.extend(true, {}, state.zfsPathMappingBrowser || defaultZfsPathMappingBrowserState());

    stopScanStatHydration();
    state.deferredDataRequestToken = deferredDataRequestToken;
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
      state.rowDetails.cache = {};
      state.rowDetails.requestToken = "";
      state.rows = $.isArray(response.rows) ? response.rows : [];
      state.summary = response.summary || { total: 0, deletable: 0, review: 0, blocked: 0, ignored: 0 };
      state.scanToken = String(response.scanToken || "");
      state.dockerRunning = response.dockerRunning !== false;
      state.auditHistory = [];
      state.auditHistoryLoading = false;
      state.auditHistoryLoaded = false;
      state.auditHistoryHasMore = false;
      state.auditHistoryRequestToken = "";
      state.scanWarningMessage = String(response.scanWarningMessage || "");
      state.scanVerification = response.scanVerification === "incomplete" ? "incomplete" : "verified";
      state.scanMetrics = $.extend(true, {}, response.scanMetrics || {});
      state.settings = $.extend({}, ACP.defaultSafetySettings(), response.settings || {});
      setAppdataSourceInfo(response.appdataSourceInfo || {});
      state.appdataSourceBrowser.manual = normalizeManualAppdataSourcesInput((state.settings || {}).manualAppdataSources || []);
      syncZfsPathMappingBrowserFromSettings();
      state.quarantine.summary = { count: 0, sizeLabel: "0 B" };
      state.quarantine.summaryRequestToken = "";
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
      loadDeferredDashboardData(deferredDataRequestToken);
    }).fail(function(xhr) {
      var pluginBusy = isPluginBusyResponse(xhr);

      resetDashboardState();
      state.appdataSourceBrowser = previousBrowserState;
      state.zfsPathMappingBrowser = previousZfsBrowserState;
      syncSafetyControls();
      renderSummaryCards();
      renderPanels();
      renderNotices([]);
      renderStateMessage(
        pluginBusy ? ACP.t(strings, "backendBusyTitle", "Backend busy") : ACP.t(strings, "scanFailedTitle", "Scan failed"),
        pluginBusy ? getPluginBusyMessage(xhr) : ACP.extractErrorMessage(xhr, ACP.t(strings, "scanFailedMessage", "The orphaned appdata scan could not be completed right now.")),
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

  function isActiveDeferredDataRequest(requestToken) {
    return !!requestToken && String(state.deferredDataRequestToken || "") === String(requestToken || "");
  }

  function loadDeferredDashboardData(requestToken) {
    loadAuditHistory(requestToken, false, 25);
    loadQuarantineSummary(requestToken, false);
  }

  function loadAuditHistory(requestToken, forceRefresh, limit) {
    var effectiveLimit = Number(limit || 0) > 0 ? Number(limit || 0) : "";
    var historyRequestToken = String(Date.now()) + ":" + String(Math.random());

    if (!isActiveDeferredDataRequest(requestToken)) {
      return;
    }

    if (state.auditHistoryLoading && !forceRefresh) {
      return;
    }

    if (!forceRefresh && state.auditHistoryLoaded && !state.auditHistoryHasMore && effectiveLimit !== "") {
      return;
    }

    state.auditHistoryLoading = true;
    state.auditHistoryRequestToken = historyRequestToken;
    renderPanels();
    if (state.auditOpen) {
      renderAuditHistoryModal();
    }

    apiPost({
      action: "getAuditHistory",
      limit: effectiveLimit
    }).done(function(response) {
      if (!isActiveDeferredDataRequest(requestToken) || String(state.auditHistoryRequestToken || "") !== historyRequestToken) {
        return;
      }

      state.auditHistory = $.isArray(response.auditHistory) ? response.auditHistory : [];
      state.auditHistoryLoaded = true;
      state.auditHistoryHasMore = !!response.hasMore;
      state.auditHistoryLoading = false;
      renderPanels();
      if (state.auditOpen) {
        renderAuditHistoryModal();
      }
    }).fail(function() {
      if (!isActiveDeferredDataRequest(requestToken) || String(state.auditHistoryRequestToken || "") !== historyRequestToken) {
        return;
      }

      state.auditHistoryLoading = false;
      renderPanels();
      if (state.auditOpen) {
        renderAuditHistoryModal();
      }
    });
  }

  function loadQuarantineSummary(requestToken, forceRefresh) {
    var summaryRequestToken = String(Date.now()) + ":" + String(Math.random());

    if (!isActiveDeferredDataRequest(requestToken)) {
      return;
    }

    if (state.quarantine.loading && !forceRefresh) {
      return;
    }

    state.quarantine.summaryRequestToken = summaryRequestToken;

    apiPost({
      action: "getQuarantineSummary"
    }).done(function(response) {
      if (!isActiveDeferredDataRequest(requestToken) || String(state.quarantine.summaryRequestToken || "") !== summaryRequestToken) {
        return;
      }

      state.quarantine.summary = $.extend({ count: 0, sizeLabel: "0 B" }, response.quarantineSummary || {});
      renderPanels();
    }).fail(function(xhr) {
      if (!isActiveDeferredDataRequest(requestToken) || String(state.quarantine.summaryRequestToken || "") !== summaryRequestToken) {
        return;
      }

      if (isPluginBusyResponse(xhr)) {
        window.setTimeout(function() {
          if (isActiveDeferredDataRequest(requestToken)) {
            loadQuarantineSummary(requestToken, forceRefresh);
          }
        }, getRetryAfterDelayMs(xhr));
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

    apiPostForUserAction({
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
      if (isQuarantineManagerModalVisible()) {
        swal(
          ACP.t(strings, "quarantineFailedTitle", "Quarantine failed"),
          ACP.extractErrorMessage(xhr, ACP.t(strings, "quarantineLoadFailedMessage", "The quarantine manager could not be loaded right now.")),
          "error"
        );
      }
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

  function renderToolsModal(allowOpen) {
    var $modal = getActiveSweetAlertModal();
    if (!$modal.length || (allowOpen !== true && !$modal.hasClass("acp-tools-modal"))) return;
    var preserve = allowOpen !== true && $modal.hasClass("acp-tools-modal");
    var body = preserve && $modal.find(".acp-tools-body")[0];
    var scrollTop = body ? body.scrollTop : 0;
    var expanded = {};
    var focusedSection = "";
    var focusedAction = "";
    if (preserve) {
      $modal.find("details[data-tools-section]").each(function() {
        var key = this.getAttribute("data-tools-section");
        expanded[key] = this.open;
        if (this.querySelector("summary") === document.activeElement) focusedSection = key;
      });
      if ($modal[0].contains(document.activeElement)) focusedAction = document.activeElement.getAttribute("data-action") || "";
    }
    ACP.applyDeleteModalClass(
      "acp-delete-modal acp-delete-results-modal acp-tools-modal",
      ACP.buildToolsModalHtml(buildContext())
    );
    if (preserve) {
      var focusTarget = null;
      $modal.find("details[data-tools-section]").each(function() {
        var key = this.getAttribute("data-tools-section");
        if (Object.prototype.hasOwnProperty.call(expanded, key)) this.open = expanded[key];
        if (key === focusedSection) focusTarget = this.querySelector("summary");
      });
      if (focusedAction) $modal.find("[data-action]").each(function() {
        if (this.getAttribute("data-action") === focusedAction && !this.disabled) focusTarget = this;
      });
      if (!focusTarget && (focusedAction || focusedSection)) focusTarget = $modal.find("button.confirm")[0];
      if (focusTarget) focusTarget.focus({preventScroll: true});
      body = $modal.find(".acp-tools-body")[0];
      if (body) body.scrollTop = scrollTop;
    }
  }

  function renderTemplateManagerModal() {
    ACP.applyDeleteModalClass(
      "acp-delete-modal acp-delete-results-modal acp-template-manager-modal",
      ACP.buildTemplateManagerModalHtml(buildContext())
    );
  }

  function isTemplateManagerModalVisible() {
    return getActiveSweetAlertModal().hasClass("acp-template-manager-modal");
  }

  function ensureTemplateManagerModal() {
    if (isTemplateManagerModalVisible()) return;
    swal({
      title: ACP.tr("Saved template cleanup"),
      text: "", type: "info", html: true, showCancelButton: false,
      confirmButtonText: ACP.t(strings, "doneLabel", "Done"), closeOnConfirm: true
    }, function() {
      window.setTimeout(function() {
        ACP.releaseModalScrollLock(false);
        renderPanels();
      }, 180);
    });
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
      if (isQuarantineManagerModalVisible()) renderQuarantineManagerModal(false);
    });
  }

  function openAuditHistoryModal() {
    if (state.busy) {
      return;
    }

    ensureAuditHistoryModal();
    renderPanels();
    renderAuditHistoryModal();

    if (!state.auditHistoryLoaded || state.auditHistoryHasMore) {
      loadAuditHistory(state.deferredDataRequestToken, true, 0);
    }
  }

  function openToolsModal() {
    if (state.busy) {
      return;
    }

    var mutationPending = isFixtureMutationPending();
    if (mutationPending) state.fixtureTools.loading = true;
    ensureToolsModal();
    renderPanels();
    renderToolsModal(true);
    // Recheck the target when reopening Tools; cached status may describe an
    // earlier appdata source. Never overlap an in-flight create/remove action.
    if (!mutationPending) {
      runFixtureManagerAction("status");
    }
  }

  function buildHelpModalHtml() {
    var modeKnown = !!state.scanToken;
    var isDeleteMode = !!(state.settings && state.settings.enablePermanentDelete);
    var steps = [
      {
        title: ACP.t(strings, "helpStepReviewTitle", "Review"),
        body: ACP.tr("Check the folder path and Details. The scan compares appdata sources, saved templates, and installed container mappings.")
      },
      {
        title: ACP.t(strings, "helpStepPreviewTitle", "Preview"),
        body: ACP.tr("Use Dry run to see what would happen before anything is changed.")
      },
      {
        title: ACP.t(strings, "helpStepCleanTitle", "Clean"),
        body: ACP.tr("Select ready items, review the proposed action, and confirm only when you no longer need the data.")
      }
    ];
    var statuses = [
      {
        label: ACP.t(strings, "cardDeletable", "Ready"), tone: "ready",
        body: ACP.tr("Current checks allow selection. Confirm you no longer need the data before acting.")
      },
      {
        label: ACP.tr("Protected"), tone: "locked",
        body: ACP.tr("A safety check prevents cleanup. Open Details for the reason and next step.")
      },
      {
        label: ACP.tr("Verification incomplete"), tone: "review",
        body: ACP.tr("Ownership checks did not complete. Rescan; if the warning remains, download diagnostics from Tools.")
      },
      {
        label: ACP.tr("Requires permanent delete"), tone: "review",
        body: ACP.tr("ZFS dataset-backed rows require permanent delete mode and cannot be quarantined.")
      },
      {
        label: ACP.t(strings, "ignoredSectionTitle", "Ignored"), tone: "neutral",
        body: ACP.tr("Hidden from normal results. Stop ignoring shows the item again without moving files.")
      }
    ];
    var questions = [
      {
        topic: "blocked", title: ACP.tr("Why is cleanup blocked?"),
        paragraphs: [
          ACP.tr("Open Details for Why cleanup is unavailable and What to check next. Safety protections have no override; keep required container mappings."),
          ACP.tr("If verification still fails after rescanning, download diagnostics from Tools and review them before sharing.")
        ],
        action: "help-open-tools", actionLabel: ACP.t(strings, "toolsOpenLabel", "Tools")
      },
      {
        topic: "no_results", title: ACP.tr("Why are there no results?"),
        paragraphs: [
          ACP.tr("Read scan warnings and check search and Show ignored before rescanning. If you expected more folders, review Appdata sources and installed container mappings."),
          ACP.tr("Skipped discovery or incomplete ownership checks can leave results empty. An empty partial scan does not confirm that all appdata is in use.")
        ],
        action: "help-open-sources", actionLabel: ACP.t(strings, "appdataSourcesOpenLabel", "Appdata sources")
      },
      {
        topic: "stopped_containers", title: ACP.tr("Why does a stopped container still block cleanup?"),
        paragraphs: [
          ACP.tr("Installed container mappings remain protected when a container is stopped. A mapping to the whole appdata root protects folders inside it and can prevent discovery. Keep required mappings; correct obsolete ones on the Docker tab and rescan."),
          ACP.tr("Other containers with access lists broad access above the appdata source; this alone does not block cleanup."),
          ACP.tr("Turning off Docker does not establish that appdata is unused. Ownership checks must complete before cleanup.")
        ]
      },
      {
        topic: "quarantine", title: ACP.tr("What do Restore and Purge do?"),
        paragraphs: [
          ACP.tr("Restore returns quarantined folders without overwriting an existing destination. Conflicts can be skipped or restored with another name. Purge permanently deletes quarantined data, including when a scheduled timer expires."),
          ACP.tr("Review purge timers in Quarantine. Changing the default also updates folders that follow that default; manually set timers remain unchanged.")
        ]
      },
      {
        topic: "updates", title: ACP.tr("What should I do after updating?"),
        paragraphs: [
          ACP.tr("Verify the installed plugin version, reload the page, and reopen the dialog. If the old interface remains, hard-refresh the browser. For persistent problems, download diagnostics from Tools and review them before sharing.")
        ]
      }
    ];
    var modeState = modeKnown
      ? (isDeleteMode ? ACP.t(strings, "offLabel", "OFF") : ACP.t(strings, "onLabel", "ON"))
      : ACP.tr("Mode unavailable");
    var currentAction = !modeKnown
      ? ACP.tr("Run a successful scan to confirm the current cleanup mode.")
      : (isDeleteMode
        ? ACP.tr("Selected folders will be permanently deleted after confirmation.")
        : ACP.tr("Selected folders will be quarantined instead of permanently deleted."));
    var html = [
      '<div class="acp-help-shell"><div class="acp-help-body">',
      '<section class="acp-help-intro">',
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M9.75 9.25a2.35 2.35 0 0 1 4.5 1c0 1.7-2.25 1.9-2.25 3.45"></path><path d="M12 16.8h.01"></path></svg>',
      '<div><h3>' + ACP.escapeHtml(ACP.t(strings, "helpIntroTitle", "Clean up appdata safely")) + '</h3><p>' + ACP.escapeHtml(ACP.tr("Review scan evidence, preview the action, then clean up only what you no longer need.")) + '</p></div>',
      '</section>',
      '<section class="acp-help-workflow"><h3>' + ACP.escapeHtml(ACP.t(strings, "helpFlowTitle", "Simple workflow")) + '</h3><ol class="acp-help-step-list">'
    ];

    $.each(steps, function(index, step) {
      html.push('<li class="acp-help-step"><span class="acp-help-step-marker">' + ACP.escapeHtml(ACP.formatCount(index + 1)) + '</span><div class="acp-help-step-copy"><h4 class="acp-help-step-title">' + ACP.escapeHtml(step.title) + '</h4><p>' + ACP.escapeHtml(step.body) + '</p></div></li>');
    });
    html.push('</ol></section><div class="acp-help-reference-grid"><section class="acp-help-reference-card"><h3>' + ACP.escapeHtml(ACP.t(strings, "helpStatesTitle", "Result states")) + '</h3><dl class="acp-help-status-list">');
    $.each(statuses, function(_, status) {
      html.push('<div class="acp-help-status"><dt><span class="acp-badge acp-badge-tone-' + ACP.escapeHtml(status.tone) + '">' + ACP.escapeHtml(status.label) + '</span></dt><dd>' + ACP.escapeHtml(status.body) + '</dd></div>');
    });
    html.push(
      '</dl></section>',
      '<section class="acp-help-mode-card ' + (!modeKnown ? 'is-unknown-mode' : (isDeleteMode ? 'is-delete-mode' : 'is-safe-mode')) + '">',
      '<h3>' + ACP.escapeHtml(ACP.t(strings, "helpSafeModeSimpleTitle", "Safe Mode")) + ' <span class="acp-help-mode-state">' + ACP.escapeHtml(modeState) + '</span></h3>',
      '<p class="' + (modeKnown ? 'acp-help-current-action' : 'acp-help-mode-unavailable') + '">' + ACP.escapeHtml(currentAction) + '</p>',
      '<ul class="acp-help-mode-notes"><li>' + ACP.escapeHtml(ACP.tr("Quarantine normally does not free space. Restore can recover quarantined folders.")) + '</li><li>' + ACP.escapeHtml(ACP.tr("Purge permanently deletes quarantined folders. Safe Mode does not prevent manual or scheduled purge.")) + '</li><li>' + ACP.escapeHtml(ACP.tr("Permanent deletion cannot be undone by this plugin.")) + '</li></ul>',
      '<p class="acp-help-safety-note">' + ACP.escapeHtml(ACP.tr("Safe Mode changes the cleanup action. It does not bypass safety protection or incomplete ownership checks.")) + '</p>',
      '<div class="acp-help-zfs-note"><strong>' + ACP.escapeHtml(ACP.t(strings, "helpZfsSimpleTitle", "ZFS datasets")) + '</strong><p>' + ACP.escapeHtml(ACP.tr("ZFS datasets cannot be quarantined. Permanent deletion can also remove child datasets and snapshots. Review the destroy impact in Details before choosing this action.")) + '</p></div>',
      '</section></div>',
      '<section class="acp-help-faq"><h3>' + ACP.escapeHtml(ACP.t(strings, "helpTroubleshootingTitle", "Common questions")) + '</h3>'
    );
    $.each(questions, function(_, question) {
      html.push('<details class="acp-help-question" data-help-topic="' + ACP.escapeHtml(question.topic) + '"><summary>' + ACP.escapeHtml(question.title) + '</summary>');
      $.each(question.paragraphs, function(_, paragraph) { html.push('<p>' + ACP.escapeHtml(paragraph) + '</p>'); });
      if (question.action) html.push('<button type="button" class="acp-button acp-button-secondary" data-action="' + ACP.escapeHtml(question.action) + '"' + (state.busy ? ' disabled' : '') + '>' + ACP.escapeHtml(question.actionLabel) + '</button>');
      html.push('</details>');
    });
    html.push('</section></div></div>');
    return html.join("");
  }
  function openHelpModal() {
    swal({
      title: ACP.t(strings, "helpTitle", "Appdata Cleanup Plus Help"),
      text: "",
      type: "info",
      html: true,
      showCancelButton: false,
      confirmButtonText: ACP.t(strings, "doneLabel", "Done"),
      closeOnConfirm: true
    }, function() {
      window.setTimeout(function() {
        ACP.releaseModalScrollLock(false);
      }, 180);
    });
    ACP.applyDeleteModalClass("acp-delete-modal acp-help-modal", buildHelpModalHtml());
  }

  function isToolsModalVisible() {
    return getActiveSweetAlertModal().hasClass("acp-tools-modal");
  }

  function openRowDetailsModal(row) {
    if (!row) {
      return;
    }

    state.rowDetails.activeRowId = String(row.id || "");

    swal({
      title: ACP.t(strings, "rowDetailsTitle", "Folder details"),
      text: "",
      type: "info",
      html: true,
      showCancelButton: false,
      confirmButtonText: ACP.t(strings, "doneLabel", "Done"),
      closeOnConfirm: true
    }, function() {
      window.setTimeout(function() {
        state.rowDetails.activeRowId = "";
        state.rowDetails.requestToken = "";
        ACP.releaseModalScrollLock(false);
        renderPanels();
      }, 180);
    });

    renderOpenRowDetailsModal(true);
    window.setTimeout(renderOpenRowDetailsModal, 0);
    loadCandidateDetails(row);
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
      zfsPathMappings: $.isArray(nextInfo.zfsPathMappings) ? nextInfo.zfsPathMappings : [],
      zfsPathMappingSuggestions: $.isArray(nextInfo.zfsPathMappingSuggestions) ? nextInfo.zfsPathMappingSuggestions : []
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

  function applyZfsPathMappingSuggestion(shareRoot, datasetRoot) {
    var normalizedShareRoot = normalizeZfsPathMapping(shareRoot || "");
    var normalizedDatasetRoot = normalizeZfsPathMapping(datasetRoot || "");

    if (!normalizedShareRoot || !normalizedDatasetRoot || normalizedShareRoot === normalizedDatasetRoot) {
      return;
    }

    state.zfsPathMappingBrowser.draft = {
      shareRoot: normalizedShareRoot,
      datasetRoot: normalizedDatasetRoot
    };
    state.zfsPathMappingBrowser.activeField = "shareRoot";
    setZfsPathMappingsFeedback(ACP.t(strings, "zfsPathMappingsSuggestionAppliedMessage", "Suggested roots loaded into the draft. Save mappings to apply them."));
    renderZfsPathMappingsModal();
  }

  function getRowDetailsCacheEntry(rowId) {
    return $.isPlainObject(state.rowDetails.cache[String(rowId || "")])
      ? state.rowDetails.cache[String(rowId || "")]
      : {};
  }

  function setRowDetailsCacheEntry(rowId, payload) {
    var targetId = String(rowId || "");

    if (!targetId) {
      return;
    }

    state.rowDetails.cache[targetId] = $.extend(true, {}, getRowDetailsCacheEntry(targetId), $.isPlainObject(payload) ? payload : {});
  }

  function mergeRowDataById(rowId, payload) {
    var targetId = String(rowId || "");
    var nextPayload = $.isPlainObject(payload) ? payload : {};

    state.rows = $.map(state.rows || [], function(row) {
      if (!row || String((row && row.id) || "") !== targetId) {
        return row;
      }

      return $.extend(true, {}, row, nextPayload);
    });
  }

  function getRowDetailsModalRow() {
    var rowId = String((state.rowDetails && state.rowDetails.activeRowId) || "");
    var row = findRowById(rowId);

    if (!row) {
      return null;
    }

    return $.extend(true, {}, row, getRowDetailsCacheEntry(rowId));
  }

  function renderOpenRowDetailsModal(allowOpen) {
    var row = getRowDetailsModalRow();
    var $modal = getActiveSweetAlertModal();

    if (!row || !$modal.length || (allowOpen !== true && !$modal.hasClass("acp-row-details-modal"))) {
      return;
    }

    var shell = $modal.find(".acp-row-details-shell")[0];
    var sameRow = !!row.id && shell && shell.getAttribute("data-row-id") === String(row.id);
    var body = sameRow && shell.querySelector(".acp-row-details-body");
    var scrollTop = body ? body.scrollTop : 0;
    var expanded = {};
    var focusedSection = "";
    var focusedAction = "";
    if (sameRow) {
      Array.prototype.forEach.call(shell.querySelectorAll("details[data-detail-section]"), function(section) {
        expanded[section.getAttribute("data-detail-section")] = section.open;
        if (section.querySelector("summary") === document.activeElement) focusedSection = section.getAttribute("data-detail-section");
      });
      var focused = document.activeElement;
      if (focused && $modal[0].contains(focused)) focusedAction = focused.getAttribute("data-action") || "";
    }

    ACP.applyDeleteModalClass(
      "acp-delete-modal acp-delete-results-modal acp-row-details-modal",
      ACP.buildRowDetailsModalHtml(buildContext(), row)
    );

    if (sameRow) {
      var focusTarget = null;
      $modal.find("details[data-detail-section]").each(function() {
        var key = this.getAttribute("data-detail-section");
        if (Object.prototype.hasOwnProperty.call(expanded, key)) this.open = expanded[key];
        if (key === focusedSection) focusTarget = this.querySelector("summary");
      });
      if (focusedAction) $modal.find(".acp-row-details-footer-actions [data-action]").each(function() {
        if (this.getAttribute("data-action") === focusedAction) focusTarget = this;
      });
      if (focusTarget) focusTarget.focus({preventScroll: true});
      body = $modal.find(".acp-row-details-body")[0];
      if (body) body.scrollTop = scrollTop;
    }
  }

  function shouldLoadCandidateDetails(row) {
    if (!row || !row.id || !state.scanToken) {
      return false;
    }

    return row.storageKind === "zfs" || !!row.zfsMappingMatched;
  }

  function loadCandidateDetails(row) {
    var rowId = String((row && row.id) || "");
    var cacheEntry = getRowDetailsCacheEntry(rowId);
    var requestToken;

    if (!shouldLoadCandidateDetails(row) || cacheEntry.detailLoaded || cacheEntry.detailLoading) {
      return;
    }

    requestToken = rowId + ":" + String(Date.now());
    state.rowDetails.requestToken = requestToken;
    setRowDetailsCacheEntry(rowId, {
      detailLoading: true,
      detailLoaded: false,
      detailError: ""
    });
    renderOpenRowDetailsModal();

    apiPostWithPluginBusyRetry({
      action: "getCandidateDetails",
      scanToken: state.scanToken,
      candidateId: rowId
    }, { retries: 2 }).done(function(response) {
      var detailRow = $.isPlainObject(response && response.row) ? response.row : {};

      if (state.rowDetails.requestToken !== requestToken) {
        recordDiagnosticsActivity("response_ignored", {action:"getCandidateDetails",reason:"superseded"});
        return;
      }

      state.rowDetails.requestToken = "";
      setRowDetailsCacheEntry(rowId, $.extend(true, {}, detailRow, {
        detailLoading: false,
        detailLoaded: true,
        detailError: ""
      }));
      mergeRowDataById(rowId, detailRow);
      renderOpenRowDetailsModal();
      renderResults();
    }).fail(function(xhr) {
      if (state.rowDetails.requestToken !== requestToken) {
        recordDiagnosticsActivity("response_ignored", {action:"getCandidateDetails",reason:"superseded"});
        return;
      }

      state.rowDetails.requestToken = "";
      setRowDetailsCacheEntry(rowId, {
        detailLoading: false,
        detailLoaded: false,
        detailError: ACP.extractErrorMessage(xhr, ACP.t(strings, "rowDetailsLoadFailedMessage", "The latest row details could not be loaded right now."))
      });
      renderOpenRowDetailsModal();
    });
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
        recordDiagnosticsActivity("response_ignored", {action:"browseAppdataSourcePath",reason:"superseded"});
        return;
      }

      setAppdataSourceBrowserPayload((response && response.browser) || {});
      state.appdataSourceBrowser.requestToken = "";

      if (isAppdataSourcesModalVisible()) {
        renderAppdataSourcesModal();
      }
    }).fail(function(xhr) {
      if (requestToken !== String(state.appdataSourceBrowser.requestToken || "")) {
        recordDiagnosticsActivity("response_ignored", {action:"browseAppdataSourcePath",reason:"superseded"});
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
          ACP.plural("Saved {count} ZFS mappings and rescanning.", mappingCount)
        );
      },
      onFailure: function(xhr) {
        setZfsPathMappingsFeedback(ACP.extractErrorMessage(xhr, ACP.t(strings, "zfsPathMappingsSaveFailedMessage", "The ZFS path mappings could not be saved right now.")));
      }
    });
  }

  function buildTemplateActionLockReason(row) {
    var parts = [ACP.tr("Saved Docker templates still reference this folder. If you clean this path, reinstalling from a saved template may expect or recreate it.")];
    if ((row.sourceNames || []).length) parts.push(ACP.tr("Saved templates: {names}.", {names: row.sourceNames.join(", ")}));
    if ((row.targetPaths || []).length) parts.push(ACP.tr("Container paths: {paths}.", {paths: row.targetPaths.join(", ")}));
    return parts.join(" ");
  }

  function applyLocalSafetyStateToRow(row) {
    var nextRow = $.extend({}, row);

    if (nextRow.scanVerificationLocked) {
      nextRow.canDelete = false;
      nextRow.policyLocked = true;
      nextRow.policyReason = row.policyReason || row.riskReason || ACP.tr("Ownership verification is incomplete. This folder has not been confirmed as orphaned.");
      nextRow.policyReasonCode = "ownership_unverified";
      if (!nextRow.ignored) {
        nextRow.risk = "blocked";
        nextRow.riskLabel = ACP.tr("Locked");
        nextRow.riskReason = nextRow.policyReason;
      }
      return nextRow;
    }

    nextRow.policyLocked = false;
    nextRow.policyReason = "";
    nextRow.policyReasonCode = "";

    if (nextRow.ignored) {
      nextRow.canDelete = false;
      return nextRow;
    }

    if (nextRow.securityLockReason) {
      nextRow.canDelete = false;
      nextRow.policyLocked = true;
      nextRow.policyReason = nextRow.securityLockReason;
      nextRow.policyReasonCode = nextRow.securityReasonCode || "";
      return nextRow;
    }

    if (nextRow.storageKind === "zfs") {
      if (!state.settings.enablePermanentDelete) {
        nextRow.canDelete = false;
        nextRow.policyLocked = true;
        nextRow.policyReason = ACP.t(strings, "selectionHintZfsMode", "ZFS dataset-backed rows require permanent delete mode and cannot be quarantined.");
        nextRow.policyReasonCode = "permanent_delete";
        return nextRow;
      }
    }

    if (nextRow.risk === "blocked") {
      nextRow.canDelete = false;
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

      var actionability = getRowActionabilityDescriptor(row).value;

      if (actionability === "ready" || actionability === "review") {
        summary.safe += 1;
      } else if (actionability === "locked") {
        summary.blocked += 1;
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
    var lockedRows = 0;

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

      if (getRowActionabilityDescriptor(row).value === "locked") {
        lockedRows += 1;
      }
    });

    return {
      scanRoots: effectiveRoots.slice(0),
      scanRootCount: effectiveRoots.length,
      templateRowCount: templateRows,
      discoveryRowCount: discoveryRows,
      reviewCount: 0,
      lockedCount: lockedRows,
      zfsBackedCount: zfsRows,
      mappedShareCount: mappedRows,
      ignoredCount: Number(summary.ignored || 0)
    };
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
        message: state.showIgnored ? ACP.tr("Ignored paths visible for review or restore: {count}.", {count: Number(summary.ignored || 0)}) : ACP.tr("Ignored paths hidden from normal cleanup results: {count}.", {count: Number(summary.ignored || 0)}),
        action: "toggle-ignored-visibility",
        actionLabel: state.showIgnored
          ? ACP.t(strings, "hideIgnoredLabel", "Hide ignored")
          : ACP.t(strings, "showIgnoredLabel", "Show ignored")
      });
    }

    if (state.scanWarningMessage) {
      notices.push({
        type: "warning",
        title: !state.scanToken ? ACP.t(strings, "scanReadOnlyTitle", "Read-only scan")
          : (state.scanVerification === "incomplete" ? ACP.tr("Verification incomplete") : ACP.tr("Scan warning")),
        message: state.scanWarningMessage,
        action: $.grep((state.scanMetrics || {}).phases || [], function(phase) { return phase.name === "filesystem_discovery" && phase.rootMounted; }).length ? "review-container-mounts" : "",
        actionLabel: ACP.tr("Review container mounts")
      });
    }

    if (state.settings.enablePermanentDelete && Number(summary.blocked || 0) > 0) {
      notices.push({
        type: "warning",
        title: ACP.t(strings, "noticeLockedPathsTitle", "Protected paths stay blocked"),
        message: ACP.t(strings, "noticeLockedPathsMessage", "Permanent delete mode does not bypass safety protection or incomplete ownership checks. Open Details on a blocked item for the reason and next step.")
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

  function pauseScanStatHydrationForUserRequest() {
    if (state.scanHydration.active) {
      stopScanStatHydration();
    }
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
    }).fail(function(xhr) {
      if (!state.scanHydration.active || state.scanHydration.requestToken !== requestToken) {
        return;
      }

      if (isPluginBusyResponse(xhr)) {
        state.scanHydration.queue = batchIds.concat(state.scanHydration.queue);
        window.setTimeout(function() {
          requestNextScanStatBatch(requestToken);
        }, getRetryAfterDelayMs(xhr));
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
    renderNotices(buildLocalNotices());
    renderResults();
    syncBulkSelectionPresetControls();
    updateActionBar();
  }

  function hasPartialDiscovery() {
    return $.grep((state.scanMetrics || {}).phases || [], function(phase) {
      return phase.name === "filesystem_discovery" && (phase.rootMounted || phase.truncated);
    }).length > 0;
  }

  function buildEmptyStateMessage() {
    var insights = buildScanInsights();
    var parts = [];

    if (hasPartialDiscovery()) {
      return ACP.tr("Folder discovery was incomplete. An empty result does not confirm that all appdata is in use. Review the scan warning before rescanning.") + (state.scanWarningMessage ? " " + state.scanWarningMessage : "");
    }

    parts.push(ACP.t(strings, "emptyNoUnusedFoundMessage", "No unused appdata folders were found under the current scan paths."));

    if (insights.scanRoots.length > 0) {
      parts.push(ACP.tr("Locations scanned: {paths}.", {paths: insights.scanRoots.join(", ")}));
    } else {
      parts.push(ACP.t(strings, "emptyNoRootsMessage", "No appdata source roots are configured right now."));
    }

    parts.push(
      state.dockerRunning
        ? ACP.t(strings, "emptyTemplatesCheckedMessage", "Saved Docker templates were checked too.")
        : ACP.t(strings, "emptyDockerOfflineCheckedMessage", "Docker is offline, so only saved Docker templates could be checked.")
    );

    if (Number(insights.templateRowCount || 0) === 0 && state.dockerRunning) {
      parts.push(ACP.t(strings, "emptyTemplateEducationMessage", "Saved Docker templates can still reference appdata after a container is removed, so they are included in the scan evidence."));
    }

    parts.push(ACP.t(strings, "emptyNextStepsMessage", "If you expected unused folders, review Appdata sources and installed container mappings, then rescan. Keep mappings that your containers still need."));

    return parts.join(" ");
  }

  function renderSummaryCards() {
    closeSummaryInfo();
    var selectedCount = getSelectedRows().length;
    var detectedIcon = '<svg viewBox="0 0 24 24" focusable="false"><circle cx="10.75" cy="10.75" r="5.75"></circle><path d="m15.25 15.25 4 4"></path></svg>';
    var readyIcon = '<svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="8.25"></circle><path d="m8.25 12.35 2.55 2.55 5.25-5.8"></path></svg>';
    var blockedIcon = '<svg viewBox="0 0 24 24" focusable="false"><rect x="6.5" y="10.25" width="11" height="8.25" rx="1.75"></rect><path d="M8.75 10.25V8.2a3.25 3.25 0 0 1 6.5 0v2.05"></path><path d="M12 13.4v2"></path></svg>';
    var selectedIcon = '<svg viewBox="0 0 24 24" focusable="false"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';
    var cards = [
      {
        key: "detected", label: state.scanVerification === "incomplete" ? ACP.tr("Unverified") : ACP.t(strings, "cardTotal", "Detected"),
        value: state.summary.total || 0, subtitle: state.scanVerification === "incomplete" ? ACP.tr("Ownership check incomplete") : ACP.tr("Scan candidates"), tone: "is-detected", iconHtml: detectedIcon,
        description: ACP.tr("Found in this scan; ignored items are excluded."),
        info: ACP.tr("Counts non-ignored folders and datasets found in the current scan, including blocked items. Search does not change this total. A partial scan may omit items, and detection does not mean data is safe to delete.")
      },
      {
        key: "ready", label: ACP.t(strings, "cardDeletable", "Ready"), value: state.summary.deletable || 0,
        subtitle: ACP.t(strings, "cardDeletableSubtitle", "Review before cleanup"), tone: "is-safe", iconHtml: readyIcon,
        description: ACP.tr("Available for review under the current cleanup settings."),
        info: ACP.tr("Counts non-ignored items allowed by the current checks and cleanup mode. Review Details and run a dry run before acting. Ready is not a guarantee that the data is no longer needed.")
      },
      {
        key: "blocked", label: ACP.t(strings, "cardBlocked", "Blocked"), value: state.summary.blocked || 0,
        subtitle: ACP.t(strings, "cardBlockedSubtitle", "Review the reason in Details"), tone: "is-blocked", iconHtml: blockedIcon,
        description: ACP.tr("Cleanup is unavailable; open Details for the reason."),
        info: ACP.tr("Counts items that cannot be cleaned under the current scan and settings. Reasons include protected storage, container mappings, incomplete ownership checks, or a ZFS dataset requiring permanent delete mode. Changing Safe Mode does not bypass safety protection.")
      },
      {
        key: "selected", label: ACP.t(strings, "cardSelected", "Selected"), value: selectedCount,
        subtitle: ACP.t(strings, "cardSelectedSubtitle", "Marked this scan"), tone: "is-selected", iconHtml: selectedIcon,
        description: ACP.tr("Chosen for the next dry run or cleanup action."),
        info: ACP.tr("Counts currently selected, non-ignored items that remain selectable. Selection can include items outside the current search. Selecting an item does not change files; the action still requires its normal checks and confirmation.")
      }
    ];
    var html = [];

    $.each(cards, function(_, card) {
      var glowClass = Number(card.value || 0) > 0 ? " has-glow" : "";
      var infoId = "acp-summary-info-" + card.key;
      html.push(
        '<article class="acp-summary-card ' + card.tone + glowClass + '">' +
          '<button type="button" class="acp-summary-info" aria-expanded="false" aria-describedby="' + infoId + '" aria-label="' + ACP.escapeHtml(ACP.tr("More information about {label}", {label: card.label})) + '">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M12 10.5v6M12 7.5h.01" stroke-linecap="round"></path></svg>' +
          '</button><div class="acp-summary-tooltip" id="' + infoId + '" role="tooltip" hidden>' + ACP.escapeHtml(card.info) + '</div>' +
          '<span class="acp-summary-icon" aria-hidden="true">' + (card.iconHtml || "") + "</span>" +
          '<span class="acp-summary-copy">' +
            '<span class="acp-summary-label">' + ACP.escapeHtml(card.label) + "</span>" +
            '<span class="acp-summary-value">' + ACP.escapeHtml(ACP.formatCount(card.value)) + "</span>" +
            '<span class="acp-summary-subtitle">' + ACP.escapeHtml(card.subtitle || "") + "</span>" +
          "</span>" +
          '<span class="acp-summary-description">' + ACP.escapeHtml(card.description) + '</span>' +
        "</article>"
      );
    });

    els.$summaryCards.html(html.join(""));
  }

  function renderNotices(notices) {
    var html = [];
    var hasNotices = $.isArray(notices) && notices.length > 0;

    $.each(notices || [], function(_, notice) {
      var actionHtml = notice.action
        ? '<button type="button" class="acp-button acp-button-secondary acp-notice-action" data-action="' + ACP.escapeHtml(notice.action) + '">' + ACP.escapeHtml(notice.actionLabel || "") + "</button>"
        : "";
      html.push(
        '<article class="acp-notice is-' + ACP.escapeHtml(notice.type || "info") + '">' +
          '<div class="acp-notice-main">' +
            '<div class="acp-notice-title">' + ACP.escapeHtml(notice.title || "") + "</div>" +
            '<div class="acp-notice-message">' + (notice.messageHtml || ACP.escapeHtml(notice.message || "")) + "</div>" +
          "</div>" +
          actionHtml +
        "</article>"
      );
    });

    els.$notices.html(html.join(""));
    if (els.$resultsContext && els.$resultsContext.length) {
      els.$resultsContext.toggleClass("has-notices", hasNotices);
    }
  }

  function renderLoadingState() {
    renderSummaryCards();
    renderPanels();
    renderNotices([]);

    if (state.rows.length) {
      renderResults();
      return;
    }

    renderLoadingResultsShell();
  }

  function renderLoadingResultsShell() {
    var rowCount = Math.max(3, Math.min(6, Number(state.summary.total || 0) || 3));
    var rowHtml = [];
    var index;

    for (index = 0; index < rowCount; index += 1) {
      rowHtml.push(
        '<article class="acp-row acp-row-loading" aria-hidden="true">' +
          '<div class="acp-row-select"><span class="acp-loading-check"></span></div>' +
          '<div class="acp-row-main">' +
            '<div class="acp-row-primary">' +
              '<div class="acp-row-loading-name"><span></span><small></small></div>' +
              '<div class="acp-row-loading-used"><span></span><small></small></div>' +
              '<div class="acp-row-loading-size"><span></span></div>' +
              '<div class="acp-row-loading-path"><span></span></div>' +
              '<div class="acp-row-loading-badge"><span></span></div>' +
              '<div class="acp-row-loading-path"><span></span></div>' +
              '<div class="acp-row-loading-actions"><span></span><span></span></div>' +
            "</div>" +
          "</div>" +
        "</article>"
      );
    }

    els.$results.html(
      '<section class="acp-results-section acp-results-section-ready acp-results-section-loading" aria-busy="true">' +
        '<header class="acp-results-section-head">' +
          '<div class="acp-results-section-copy">' +
            '<h3 class="acp-results-section-title">' + ACP.escapeHtml(ACP.t(strings, "readySectionTitle", "Ready to Clean")) + "</h3>" +
            '<p class="acp-results-section-message">' + ACP.escapeHtml(ACP.t(strings, "loadingMessage", "Reviewing orphaned appdata folders and active container mappings.")) + "</p>" +
          "</div>" +
          '<div class="acp-results-section-meta">' +
            '<div class="acp-results-section-badges">' +
              '<span class="acp-badge acp-badge-kind-count">' + ACP.escapeHtml(ACP.t(strings, "loadingShortLabel", "Scanning")) + "</span>" +
            "</div>" +
          "</div>" +
        "</header>" +
        '<div class="acp-results-table-head">' +
          '<span></span><span>' + ACP.escapeHtml(ACP.t(strings, "nameLabel", "Name")) + '</span><span>' + ACP.escapeHtml(ACP.tr("Last modified")) + '</span><span>' + ACP.escapeHtml(ACP.t(strings, "sizeLabel", "Size")) + '</span><span>' + ACP.escapeHtml(ACP.t(strings, "pathLabel", "Path")) + '</span><span>' + ACP.escapeHtml(ACP.t(strings, "sourceLabel", "Source")) + '</span><span>' + ACP.escapeHtml(ACP.tr("Detection reason")) + '</span><span>' + ACP.escapeHtml(ACP.t(strings, "actionsLabel", "Actions")) + '</span>' +
        "</div>" +
        '<div class="acp-results-section-body">' + rowHtml.join("") + "</div>" +
      "</section>"
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

  var diagnosticsFailures = [];
  var diagnosticsCaptureStartedAt = new Date().toISOString();
  var diagnosticsFailureTotal = 0;
  var diagnosticsCaptureInstalled = false;

  function diagnosticsBoundedNumber(value, maximum) {
    value = Number(value);
    return isFinite(value) ? Math.max(0, Math.min(maximum, Math.floor(value))) : 0;
  }

  function diagnosticsAction(value) {
    var actions = "getOrphanAppdata getAuditHistory getQuarantineSummary hydrateCandidateStats getCandidateDetails saveSafetySettings browseAppdataSourcePath updateCandidateState executeCandidateAction fixtureManagerAction getOperationProgress getRecentOperations acknowledgeOperation getQuarantineEntries updateQuarantinePurgeSchedule inspectQuarantineRestore quarantineManagerAction templateManagerAction getDiagnosticsBundle javascript".split(" ");
    return actions.indexOf(value) !== -1 ? value : "unknown";
  }

  function recordDiagnosticsActivity(event, details) {
    if ("modal_open modal_close request_started request_completed request_failed response_ignored export_started export_collected export_completed export_failed export_ignored javascript_error selection_changed".split(" ").indexOf(event) === -1) return;
    details = details || {};
    var entry = {event: event, elapsedMs: diagnosticsBoundedNumber(Date.now() - diagnosticsActivityClock, 604800000)};
    if (details.action) entry.action = diagnosticsAction(details.action);
    if (details.request) entry.request = diagnosticsBoundedNumber(details.request, 2147483647);
    if ("none tools help details sources mappings templates quarantine audit recovery review progress results other".split(" ").indexOf(details.modal) !== -1) entry.modal = details.modal;
    if ("status create remove".split(" ").indexOf(details.fixtureAction) !== -1) entry.fixtureAction = details.fixtureAction;
    if ("superseded inactive already_running collection_failed download_failed request_failed invalid_response".split(" ").indexOf(details.reason) !== -1) entry.reason = details.reason;
    if (details.httpStatus !== undefined) entry.httpStatus = diagnosticsBoundedNumber(details.httpStatus, 599);
    if (details.durationMs !== undefined) entry.durationMs = diagnosticsBoundedNumber(details.durationMs, 86400000);
    if (["main", "shared", "panels"].indexOf(details.module) !== -1) entry.module = details.module;
    if (details.line !== undefined) entry.line = diagnosticsBoundedNumber(details.line, 1000000);
    if (details.column !== undefined) entry.column = diagnosticsBoundedNumber(details.column, 1000000);
    if (details.selectedCount !== undefined) entry.selectedCount = diagnosticsBoundedNumber(details.selectedCount, 1000000);
    diagnosticsActivityTotal++;
    diagnosticsActivity.push(entry);
    if (diagnosticsActivity.length > 100) diagnosticsActivity.shift();
  }

  function buildDiagnosticsActivity() {
    var requests = {};
    var requestCount = 0;
    var events = diagnosticsActivity.map(function(entry) {
      var copy = $.extend({}, entry);
      if (copy.request) {
        if (!requests[copy.request]) requests[copy.request] = "request-" + (++requestCount);
        copy.request = requests[copy.request];
      }
      return copy;
    });
    return {status:diagnosticsActivityTotal > events.length ? "partial" : "complete",captureStartedAt:diagnosticsActivityStartedAt,
      limit:100,totalCount:diagnosticsActivityTotal,includedCount:events.length,omittedCount:diagnosticsActivityTotal-events.length,events:events};
  }

  function diagnosticsModalKind(className) {
    var kind = "none";
    var kinds = {"acp-tools-modal":"tools","acp-help-modal":"help","acp-row-details-modal":"details","acp-appdata-sources-modal":"sources","acp-zfs-path-mappings-modal":"mappings","acp-template-manager-modal":"templates","acp-quarantine-manager-modal":"quarantine","acp-audit-history-modal":"audit","acp-operation-recovery-modal":"recovery","acp-delete-modal-review":"review","acp-delete-progress-running":"progress","acp-delete-results-modal":"results"};
    Object.keys(kinds).some(function(key) { if (String(className || "").split(/\s+/).indexOf(key) !== -1) { kind = kinds[key]; return true; } return false; });
    return kind;
  }

  ACP.noteDiagnosticsModal = function(className) {
    var kind = diagnosticsModalKind(className);
    if (kind === diagnosticsLastModal) return;
    if (kind !== "none") recordDiagnosticsActivity("modal_open", {modal:kind});
    else if (diagnosticsLastModal !== "none") recordDiagnosticsActivity("modal_close", {modal:diagnosticsLastModal});
    diagnosticsLastModal = kind;
  };

  function captureDiagnosticsUi() {
    var $modal = getActiveSweetAlertModal();
    var body = $modal.find(".acp-tools-body, .acp-help-body, .acp-row-details-body")[0] || $modal.find(".acp-modal-host")[0];
    var focused = document.activeElement;
    var action = focused && $modal.length && $modal[0].contains(focused) ? focused.getAttribute("data-action") : "";
    var actions = "export-diagnostics create-test-fixtures remove-test-fixtures refresh-test-fixtures open-zfs-path-mappings help-open-tools help-open-sources row-detail-select row-detail-ignore row-detail-restore".split(" ");
    var sections = [];
    $modal.find("details[open]").each(function() {
      var key = this.getAttribute("data-tools-section") || this.getAttribute("data-detail-section") || this.getAttribute("data-help-topic");
      if ("diagnostics_privacy test_data export_summary technical broad_access specific_mounts timestamp blocked no_results stopped_containers quarantine updates".split(" ").indexOf(key) !== -1 && sections.indexOf(key) === -1) sections.push(key);
    });
    return {modal:$modal.length ? diagnosticsModalKind($modal.attr("class")) : "none",openSections:sections,
      focus:action && actions.indexOf(action) !== -1 ? action : (focused && $modal.length && $modal[0].contains(focused) ? (focused.tagName === "SUMMARY" ? "summary" : (focused.classList.contains("confirm") ? "done" : "other")) : "outside"),
      scroll:{top:diagnosticsBoundedNumber(body && body.scrollTop,10000000),clientHeight:diagnosticsBoundedNumber(body && body.clientHeight,20000),scrollHeight:diagnosticsBoundedNumber(body && body.scrollHeight,10000000),horizontalOverflow:!!body && body.scrollWidth > body.clientWidth + 2},
      fixtureOperation:{pending:isFixtureMutationPending(),action:["status","create","remove"].indexOf(fixtureToolsPendingAction) !== -1 ? fixtureToolsPendingAction : "none"}};
  }

  function captureDiagnosticsBrowser() {
    var ua = String((window.navigator || {}).userAgent || "");
    var match;
    var family = /Edg\//.test(ua) ? "edge" : (/Firefox\//.test(ua) ? "firefox" : (/Chrome\//.test(ua) ? "chromium" : (/Safari\//.test(ua) ? "safari" : "unknown")));
    match = (family === "edge" ? /Edg\/(\d+)/ : (family === "firefox" ? /Firefox\/(\d+)/ : (family === "chromium" ? /Chrome\/(\d+)/ : /Version\/(\d+)/))).exec(ua);
    return {family:family,majorVersion:diagnosticsBoundedNumber(match && match[1],9999),
      auroraEnhanced:!!document.documentElement && document.documentElement.classList.contains("tp-enhance"),
      reducedMotion:!!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      coarsePointer:!!window.matchMedia && window.matchMedia("(pointer: coarse)").matches};
  }

  function recordDiagnosticsFailure(action, httpStatus, category, durationMs, requestData, response) {
    var actions = "getOrphanAppdata getAuditHistory getQuarantineSummary hydrateCandidateStats getCandidateDetails saveSafetySettings browseAppdataSourcePath updateCandidateState executeCandidateAction fixtureManagerAction getOperationProgress getQuarantineEntries updateQuarantinePurgeSchedule inspectQuarantineRestore quarantineManagerAction templateManagerAction getDiagnosticsBundle javascript".split(" ");
    var categories = "timeout abort parsererror error application TypeError ReferenceError RangeError SyntaxError URIError EvalError rejection".split(" ");
    diagnosticsFailureTotal++;
    diagnosticsFailures.push({
      occurredAt: new Date().toISOString(),
      action: actions.indexOf(action) !== -1 ? action : "unknown",
      httpStatus: Math.max(0, Math.min(599, Math.floor(Number(httpStatus) || 0))),
      category: categories.indexOf(category) !== -1 ? category : "unknown",
      durationMs: Math.max(0, Math.min(86400000, Math.floor(Number(durationMs) || 0))),
      fixtureAction: action === "fixtureManagerAction" && ["status", "create", "remove"].indexOf((requestData || {}).managerAction) !== -1 ? requestData.managerAction : "none",
      fixtureRootReason: action === "fixtureManagerAction" ? diagnosticsFixtureRootReason(response && response.status) : "unknown"
    });
    if (diagnosticsFailures.length > 20) diagnosticsFailures.shift();
  }

  function diagnosticsFixtureRootReason(status) {
    var code = status && status.rootReasonCode;
    return ["ready", "missing", "not_writable", "unsafe_symlink", "unsafe_path", "no_sources"].indexOf(code) !== -1 ? code : "unknown";
  }

  function installDiagnosticsErrorCapture() {
    if (diagnosticsCaptureInstalled) return;
    diagnosticsCaptureInstalled = true;
    var ownedScript = /\/plugins\/appdata\.cleanup\.plus\/scripts\/appdata\.cleanup\.plus(?:\.(?:shared|panels))?\.js(?:[?:\s]|$)/;
    window.addEventListener("error", function(event) {
      if (ownedScript.test(String(event.filename || ""))) {
        recordDiagnosticsFailure("javascript", 0, event.error && event.error.name, 0);
        recordDiagnosticsActivity("javascript_error", {action:"javascript",module:/\.shared\.js/.test(event.filename) ? "shared" : (/\.panels\.js/.test(event.filename) ? "panels" : "main"),line:event.lineno,column:event.colno});
      }
    });
    window.addEventListener("unhandledrejection", function(event) {
      if (event.reason && ownedScript.test(String(event.reason.stack || ""))) {
        recordDiagnosticsFailure("javascript", 0, "rejection", 0);
        recordDiagnosticsActivity("javascript_error", {action:"javascript"});
      }
    });
  }

  function buildDiagnosticsRedactor() {
    return {
      aliases: {
        name: Object.create(null),
        template: Object.create(null),
        mount: Object.create(null),
        share: Object.create(null),
        segment: Object.create(null),
        row: Object.create(null)
      },
      counters: {
        name: 0,
        template: 0,
        mount: 0,
        share: 0,
        segment: 0,
        row: 0
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
      redactor.aliases[kind] = Object.create(null);
      redactor.counters[kind] = 0;
    }

    if (Object.prototype.hasOwnProperty.call(redactor.aliases[kind], value)) {
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
    var text = String(value || "").replace(/\\\//g, "/");
    var paths = [];
    var protectPath = function(path) {
      paths.push(sanitizeDiagnosticsPath(path, redactor));
      return "<diagnosticspath-" + String(paths.length) + ">";
    };
    // Redact URLs before path/name replacement can consume their scheme.
    // Also handle scheme fragments from older server-side diagnostic scrubs.
    text = text.replace(/(?:\b(?:https?|wss?|ftp|file):|<path(?:-\d+)?>:)\/\/[^\s<>"']+/gi, "<url>");
    // Scrub paths before registered names can replace a root or an interior
    // component. Quoted paths may contain spaces and punctuation; unquoted
    // paths stop at log delimiters, retaining canonical failure reasons.
    text = text.replace(/(['"])((?:\/|[A-Za-z]:[\\/]|\\)(?:\\.|(?!\1)[^\r\n])*?)\1/g, function(_, quote, path) {
      return quote + protectPath(path) + quote;
    });
    var alias = "<(?:audit-)?(?:path|mount|share|app|name|container|dataset|snapshot|row|template)(?:-\\d+)?>(?:\\.xml)?";
    var first = "(?:" + alias + "|[^\\s/\\\\'\"<>\\[\\]{}(),;:])";
    var rest = "(?:" + alias + "|[^\\r\\n'\"<>\\[\\]{}(),;:])";
    var absolutePath = new RegExp("(^|[^A-Za-z0-9_./\\\\-])((?:/+|[A-Za-z]:[\\\\/]|\\\\+)" + first + rest + "*)", "g");
    text = text.replace(absolutePath, function(_, prefix, candidate) {
      var reason = candidate.match(/(\s+(?:Permission denied|No such file or directory|Input\/output error|Read-only file system|Operation not permitted|No space left on device|Device or resource busy|File exists|Directory not empty|Not a directory|Is a directory|Too many open files|Connection timed out|is missing|is unavailable|was not found|could not be read|failed)[.!?]?)\s*$/i);
      var suffix = reason ? reason[0] : ((candidate.match(/\s+$/) || [""])[0]);
      var path = candidate.slice(0, candidate.length - suffix.length);
      return prefix + protectPath(path) + suffix;
    });
    var replacements = (redactor && $.isArray(redactor.replacements) ? redactor.replacements.slice(0) : []).sort(function(left, right) {
      return String(right.raw || "").length - String(left.raw || "").length;
    });

    $.each(replacements, function(_, replacement) {
      var raw = String((replacement && replacement.raw) || "");
      var sanitized = String((replacement && replacement.sanitized) || "");

      if (!raw || !sanitized) {
        return;
      }

      // Match complete identifier words, and never re-redact an alias emitted
      // earlier in this export. Names such as "data" must not corrupt prose.
      var pattern = /^[A-Za-z0-9_]+$/.test(raw) ? new RegExp("\\b" + raw + "\\b", "g") : null;
      text = text.split(/(<(?:audit-)?[a-z]+(?:-\d+)?>)/g).map(function(part, index) {
        if (index % 2) return part;
        return pattern ? part.replace(pattern, function() { return sanitized; }) : part.split(raw).join(sanitized);
      }).join("");
    });

    text = text.replace(/(\b(?:authorization|proxy-authorization)\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, "$1<redacted>");
    text = text.replace(/(\b(?:cookie|set-cookie)\s*:\s*)[^\r\n]+/gi, "$1<redacted>");
    text = text.replace(/([?&](?:csrf|token|key|password|passwd|pass|secret|session|auth|api[_-]?key|access[_-]?token|refresh[_-]?token)[^=\s]*=)[^\s&]+/gi, "$1<redacted>");
    text = text.replace(/(\b(?:csrf|token|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|session|auth|credential|client[_-]?secret)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, "$1<redacted>");
    text = text.replace(/(\b(?:https?|wss?):\/\/)(?:[^/@\s]+@)?\[[^\]\s]+\](?::\d+)?/gi, "$1<host>");
    text = text.replace(/(\b(?:https?|wss?):\/\/)(?:[^/@\s]+@)?[^/\s:]+(?::\d+)?/gi, "$1<host>");
    text = text.replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, "<jwt>");
    text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<email>");
    text = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "<ipv4>");
    text = text.replace(/\b(?:[A-F0-9]{2}:){5}[A-F0-9]{2}\b/gi, "<mac>");
    text = text.replace(/(?:[A-F0-9]{0,4}:){2,7}[A-F0-9]{0,4}/gi, function(candidate) {
      var colonCount = (candidate.match(/:/g) || []).length;
      return candidate.indexOf("::") !== -1 || colonCount >= 7 ? "<ipv6>" : candidate;
    });
    text = text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>");
    text = text.replace(/\b[0-9a-f]{32,}\b/gi, "<hex>");
    text = text.replace(/\b[A-Za-z0-9_-]{40,}\b/g, "<token>");
    text = text.replace(/(\b(?:host|hostname|server[_-]?name|tower[_-]?name)\b\s*[:=]\s*)[^\s,;]+/gi, "$1<host>");
    text = text.replace(/\b[A-Z0-9][A-Z0-9.-]*\.(?:local|lan|home|internal)\b/gi, "<host>");

    return text.replace(/<diagnosticspath-(\d+)>/g, function(token, index) { return paths[Number(index) - 1] || token; });
  }

  function sanitizeDiagnosticsRowId(value, redactor) {
    return getDiagnosticsAlias(redactor, "row", value, "row");
  }

  function diagnosticsKeyIsSensitive(key) {
    var normalized = String(key || "").replace(/([a-z0-9])([A-Z])/g, "$1_$2");
    return /(?:^|[_-])(?:authorization|cookie|csrf|token|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|session|auth|credential|client[_-]?secret)(?:$|[_-])/i.test(normalized);
  }

  function diagnosticsKeyLooksLikePath(key) {
    return /(?:path|root|directory|dir|mountpoint|destination|source|target)$/i.test(String(key || ""));
  }

  function diagnosticsMetadataValueIsPublic(value, keyName) {
    if (typeof value !== "string") return false;
    var codes = "";
    switch (keyName) {
      case "event":
        codes = "modal_open modal_close request_started request_completed request_failed response_ignored export_started export_collected export_completed export_failed export_ignored javascript_error selection_changed";
        break;
      case "modal":
        codes = "none tools help details sources mappings templates quarantine audit recovery review progress results other";
        break;
      case "module":
        codes = "main shared panels";
        break;
      case "action":
        codes = "getOrphanAppdata getAuditHistory getQuarantineSummary hydrateCandidateStats getCandidateDetails saveSafetySettings browseAppdataSourcePath updateCandidateState executeCandidateAction fixtureManagerAction getOperationProgress getRecentOperations acknowledgeOperation getQuarantineEntries updateQuarantinePurgeSchedule inspectQuarantineRestore quarantineManagerAction templateManagerAction getDiagnosticsBundle javascript status create remove none unknown";
        break;
      case "fixtureAction":
        codes = "status create remove none";
        break;
      case "fixtureRootReason":
      case "rootReason":
        codes = "ready missing not_writable unsafe_symlink unsafe_path no_sources unknown";
        break;
      case "reason":
        codes = "superseded inactive already_running collection_failed download_failed request_failed invalid_response bounded_collection record_limit byte_limit size_limit invalid_records source_unavailable not_loaded unknown";
        break;
      case "category":
        codes = "timeout abort parsererror error application TypeError ReferenceError RangeError SyntaxError URIError EvalError rejection collection_failed request_failed invalid_response none unknown";
        break;
      case "omissionReason":
        codes = "bounded_collection record_limit byte_limit size_limit invalid_records source_unavailable collection_failed request_failed invalid_response not_loaded unknown missing unreadable inspection_refused unsafe_path unsafe_symlink unsafe_hardlink unsafe_owner unsafe_permissions invalid_type invalid_json required_source_missing";
        break;
      case "sourceStatus":
        codes = "complete partial unavailable failed";
        break;
      case "reasonCode":
        codes = "invalid_records bounded_collection required_source_missing";
        break;
      case "sourceReasonCode":
        codes = "verified missing unreadable inspection_refused unsafe_path unsafe_symlink unsafe_hardlink unsafe_owner unsafe_permissions invalid_type invalid_json size_limit";
        break;
      case "timestampSource":
        codes = "issued_at file_modified_at";
        break;
      case "selectionScope":
        codes = "newest_among_inspected_files all_snapshot_files";
        break;
      case "evidenceScope":
        codes = "latest_persisted_scan";
        break;
      case "family":
        codes = "edge firefox chromium safari unknown";
        break;
      case "openSections":
        codes = "diagnostics_privacy test_data export_summary technical broad_access specific_mounts timestamp blocked no_results stopped_containers quarantine updates";
        break;
      case "focus":
        codes = "export-diagnostics create-test-fixtures remove-test-fixtures refresh-test-fixtures open-zfs-path-mappings help-open-tools help-open-sources row-detail-select row-detail-ignore row-detail-restore summary done other outside";
        break;
      case "health":
        codes = "ok warning error unknown";
        break;
      case "severity":
        codes = "warning error info";
        break;
      case "nextStep":
        codes = "reload rescan review_collection review_diagnostics";
        break;
      case "section":
        if (/^log-(?:[1-9]|10)$/.test(value)) return true;
        codes = "browser rows visibleRows selectedRows auditHistory recentFailures activity server runtime currentSnapshot troubleshooting fixtureRoot safetySettings quarantineRegistry ignoredCandidates runtimeLocks statsCache mountInventoryCurrent latestScanMetrics snapshots other";
        break;
      case "id":
        codes = "check versionMatch scanMatch current-snapshot collection config-directory state-files runtime-locks runtime-safety stats-cache mount-inventory-current quarantine-state docker-runtime command-execution support-logs latest-scan docker-ownership config runtime snapshot-storage quarantine-root safety-settings quarantine-registry ignored-candidates audit-history latest-scan-metrics";
        break;
      case "match":
      case "versionMatch":
      case "scanMatch":
        codes = "match mismatch unknown";
        break;
      case "currentSnapshot":
        codes = "unavailable expired invalid missing unreadable empty valid unknown";
        break;
      case "pluginVersion":
      case "browserVersion":
      case "serverVersion":
      case "browser":
      case "server":
        return value === "unknown" || /^\d{4}\.\d{2}\.\d{2}\.\d{2}$/.test(value);
      case "generatedAt":
      case "browserCapturedAt":
      case "completedAt":
      case "captureStartedAt":
      case "occurredAt":
      case "startedAt":
      case "collectedAt":
      case "issuedAt":
      case "expiresAt":
      case "modifiedAt":
        return /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) && isFinite(Date.parse(value));
      case "request":
        return /^request-(?:[1-9]\d?|100)$/.test(value);
    }
    return !!codes && codes.split(" ").indexOf(value) !== -1;
  }

  function sanitizeDiagnosticsValue(value, redactor, keyName) {
    var sanitized = {};

    // Only fixed key/value pairs bypass name replacement. Containers and
    // free-text summaries still recurse, even when their key is public.
    if (diagnosticsMetadataValueIsPublic(value, keyName)) return value;
    if (keyName === "mountInspection") return sanitizeDiagnosticsMountInspection(value);
    if (keyName === "mountReasonCode") return diagnosticsMountReasonCode(value);
    if (keyName === "status" && "complete partial unavailable failed verified incomplete not_checked ok info warning error unknown expired invalid missing unreadable empty valid".split(" ").indexOf(value) !== -1) return value;
    if (keyName === "validation" && "valid invalid missing unreadable inspection_refused skipped-large-file".split(" ").indexOf(value) !== -1) return value;
    if (keyName === "reasonCode" || keyName === "inspectionStatus") {
      var healthCodes = "verified verified_empty missing inspection_refused unsafe_path unsafe_symlink unsafe_hardlink unsafe_owner unsafe_permissions invalid_type unreadable invalid_json size_limit ready not_writable no_sources unknown not_checked mount_inventory_unavailable mount_inventory_empty mount_inventory_invalid filesystem_metadata_failed".split(" ");
      if (healthCodes.indexOf(value) !== -1) return value;
    }
    if (keyName === "reasonCounts") {
      "verified missing inspection_refused unsafe_path unsafe_symlink unsafe_hardlink unsafe_owner unsafe_permissions invalid_type unreadable invalid_json size_limit invalid_records ready not_writable no_sources directory mount mount_inventory_unavailable mount_inventory_empty mount_inventory_invalid filesystem_metadata_failed".split(" ").forEach(function(code) {
        if (value && Object.prototype.hasOwnProperty.call(value, code)) sanitized[code] = Math.max(0, Math.min(100000000, Math.floor(Number(value[code]) || 0)));
      });
      return sanitized;
    }
    if (keyName === "storage" && value === "runtime") return value;
    if (keyName === "storageKind" && "filesystem folder zfs zfs_unavailable".split(" ").indexOf(value) !== -1) return value;
    if (keyName === "zfsResolutionKind" && "filesystem exact_dataset mapped_no_exact_mountpoint zfs_unavailable".split(" ").indexOf(value) !== -1) return value;
    if (keyName === "dockerInventory" || keyName === "ownershipDiagnostics") return sanitizeDiagnosticsDockerInventory(value);
    if (keyName === "decision") {
      var codes = "discovery template unknown unavailable exact_dataset folder storage_unknown zfs_unavailable mapping_without_exact_dataset specific_mount broad_access ownership_unverified symlink mount_point root_path unsafe_path protected_path permanent_delete zfs_disabled policy_lock not_actionable none mount_inventory_unavailable mount_inventory_empty mount_inventory_invalid filesystem_metadata_failed".split(" ");
      var safeCode = function(code) { return codes.indexOf(code) !== -1 ? code : "unknown"; };
      var safeDecision = value || {};
      return {source:safeCode(safeDecision.source),storage:safeCode(safeDecision.storage),evidence:$.map((safeDecision.evidence || []).slice(0,10),safeCode),blockers:$.map((safeDecision.blockers || []).slice(0,10),safeCode),primaryBlocker:safeCode(safeDecision.primaryBlocker),specificMountCount:Math.max(0,Number(safeDecision.specificMountCount)||0),broadAccessCount:Math.max(0,Number(safeDecision.broadAccessCount)||0),ignored:!!safeDecision.ignored};
    }

    if (diagnosticsKeyIsSensitive(keyName)) {
      if (/(?:present|count|enabled|exists)$/i.test(String(keyName || "")) && (typeof value === "boolean" || typeof value === "number")) {
        return value;
      }

      return "<redacted>";
    }

    if ($.isArray(value)) {
      return $.map(value, function(item) {
        return sanitizeDiagnosticsValue(item, redactor, keyName);
      });
    }

    if ($.isPlainObject(value)) {
      $.each(value, function(key, item) {
        var sanitizedKey = diagnosticsSchemaKey(key) ? key : sanitizeDiagnosticsFreeText(key, redactor);
        sanitized[sanitizedKey] = sanitizeDiagnosticsValue(item, redactor, key);
      });
      return sanitized;
    }

    if (typeof value === "string") {
      return diagnosticsKeyLooksLikePath(keyName)
        ? sanitizeDiagnosticsPath(value, redactor)
        : sanitizeDiagnosticsFreeText(value, redactor);
    }

    return value;
  }


  function diagnosticsSchemaKey(key) {
    if ("invalidRecordCount inspectedLineCount scannedByteCount scannedByteLimit recordLimit inspectionLimit recentLimit readByteLimitPerFile inspectedCount uninspectedCount selectionScope timestampSource modifiedAt readByteCount readByteLimit sourceStatus sourceReasonCode evidenceScope unknownCount missingCount auditValidationWindow jsonReadByteLimitPerFile snapshotInspectionLimit".split(" ").indexOf(String(key)) !== -1) return true;
    if ("activity events event elapsedMs request modal module line column durationMs httpStatus action fixtureAction reason captureStartedAt limit totalCount includedCount omittedCount browser family majorVersion auroraEnhanced reducedMotion coarsePointer dialog openSections focus scroll top clientHeight scrollHeight horizontalOverflow fixtureOperation pending exportCompletion supportSummary health headline versions match freshness counts reportedRows omittedRows failedRequests activityEvents omittedEvents findings severity nextStep limitations section completedAt browserCapturedAt selectedCount fixtureTools statusLoaded loading requestFailed rootAvailable rootReason fixtureRootReason detected visible selected server visibleRows selectedRows fixtureRoot safetySettings quarantineRegistry ignoredCandidates latestScanMetrics snapshots statusCounts info warning error".split(" ").indexOf(String(key)) !== -1) return true;
    if ("mountInspection mountInventoryCurrent mountReasonCode inspectionStatus reasonCounts refusedCount ttlSeconds entryCount validEntryCount expiredEntryCount invalidEntryCount checkCount failedCheckCount mountCount validation valid modifiedAt sizeBytes runtimeLocks statsCache".split(" ").indexOf(String(key)) !== -1) return true;
    if ("collection sections status includedCount omittedCount omissionReason freshness browserVersion serverVersion versionMatch scanMatch currentSnapshot collectedAt issuedAt expiresAt candidateCount localization locale languageTag direction viewport width height capabilities numberFormat pluralRules relativeTimeFormat dateTimeFormat recentFailures occurredAt action httpStatus category totalCount decision evidence blockers primaryBlocker source storage specificMountCount broadAccessCount ignored captureStartedAt".split(" ").indexOf(String(key)) !== -1) return true;
    if (["mountEvidence", "broadMountEvidence", "paths"].indexOf(String(key)) !== -1) return true;
    // Fixed schema keys are metadata, not user values. Unknown/path-based keys
    // still go through the full scrub. A folder named "data" must not rename
    // datasetName or appdataSources and make support exports unreadable.
    return ("schemaVersion generatedAt pluginVersion redaction sanitized enabled version strategy hostTheme name themeClass uiState searchActive searchLength sortMode busy scan dockerRunning scanTokenPresent scanWarningMessage scanVerification summary metrics insights visibleRowCount selectedRowCount pendingStatCount settings appdataSources quarantine notices auditHistory rows visibleRowIds selectedRowIds serverDiagnostics troubleshooting ok runtime state logs collector data path exists readable count limit total safe review blocked deletable ignored id sourceKind sourceLabel sourceDisplay sourceRoot sourceNames sourceSummary sourceCount targetPaths targetSummary targetCount templateRefs storageKind storageLabel storageDetail datasetName datasetMountpoint zfsMappingMatched zfsResolutionKind zfsResolutionMessage zfsResolutionDetail zfsMatchedShareRoot zfsMatchedDatasetRoot zfsResolutionVariants displayPath realPath risk riskLabel riskReason reason status statusLabel canDelete insideDefaultShare insideConfiguredSource shareName depth sizeBytes sizeLabel lastModified lastModifiedIso lastModifiedLabel lastModifiedExact statsPending securityLockReason policyLocked policyReason ignoredAt ignoredAtLabel ignoredReason scanVerificationLocked securityReasonCode policyReasonCode zfsImpactSummary zfsChildDatasets zfsSnapshots zfsPreviewError enablePermanentDelete enableZfsDatasetDelete quarantineRoot defaultQuarantinePurgeDays manualAppdataSources zfsPathMappings startedAt totalMs phases durationMs elapsedMs templateFileCount containerCount engineReachable templateVolumeCount projectCount fileCount protectedPathCount uncertain filesystemVolumeCount directChildDirectoryCount truncated rootMounted beforeCount afterCount rowCount dockerInventoryUnverified composeInventoryUncertain snapshotWritten dockerInventory verified querySucceeded reasonCode receivedCount acceptedCount rejectedCount deadCount unnamedDeadCount nullMountCount inspectCount recoveredCount inspectLimit responseByteLimit issues verification ageSeconds phaseCount slowestPhase warningFlags snapshot verificationLocks protectionLocks").split(" ").indexOf(String(key)) !== -1;
  }

  function sanitizeDiagnosticsDockerInventory(value) {
    value = value || {};
    var codes = "not_checked verified runtime_missing client_unavailable method_unavailable request_failed response_too_large invalid_json invalid_list invalid_record invalid_names invalid_mounts unsupported_mount invalid_mount_source inspect_failed inspect_limit exception incomplete_inventory".split(" ");
    var result = {verified:value.verified === true,querySucceeded:value.querySucceeded === true,reasonCode:codes.indexOf(value.reasonCode) === -1 ? "not_checked" : value.reasonCode,issues:{}};
    "receivedCount acceptedCount rejectedCount deadCount unnamedDeadCount nullMountCount inspectCount recoveredCount inspectLimit responseByteLimit durationMs".split(" ").forEach(function(key) {
      result[key] = Math.max(0, Math.min(100000000, Math.floor(Number(value[key]) || 0)));
    });
    codes.forEach(function(code) {
      var count = Math.max(0, Math.min(100000000, Math.floor(Number((value.issues || {})[code]) || 0)));
      if (count) result.issues[code] = count;
    });
    return result;
  }

  function diagnosticsMountReasonCode(value) {
    return "directory mount mount_inventory_unavailable mount_inventory_empty mount_inventory_invalid filesystem_metadata_failed".split(" ").indexOf(value) !== -1 ? value : "not_checked";
  }

  function sanitizeDiagnosticsMountInspection(value) {
    var counts = {};
    value = value || {};
    var total = 0, failed = 0;
    "directory mount mount_inventory_unavailable mount_inventory_empty mount_inventory_invalid filesystem_metadata_failed".split(" ").forEach(function(code) {
      counts[code] = Math.max(0, Math.min(100000000, Math.floor(Number((value.reasonCounts || {})[code]) || 0)));
      total += counts[code];
      if (code !== "directory" && code !== "mount") failed += counts[code];
    });
    return {status:total === 0 ? "not_checked" : (failed ? "incomplete" : "verified"),checkCount:total,failedCheckCount:failed,reasonCounts:counts};
  }

  function sanitizeDiagnosticsScanMetrics(value) {
    value = value || {};
    var names = "settings template_glob docker_state docker_query template_scan compose_scan filesystem_discovery candidate_filtering row_build snapshot_write fallback_heavy_row_build filter_installed filter_compose filter_existing filter_parent filter_parent_mounts filter_vm".split(" ");
    var result = {startedAt:/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(value.startedAt || "") ? value.startedAt : "",totalMs:Math.max(0, Math.min(100000000, Number(value.totalMs) || 0)),phases:[],dockerInventory:sanitizeDiagnosticsDockerInventory(value.dockerInventory)};
    result.mountInspection = sanitizeDiagnosticsMountInspection(value.mountInspection);
    (Array.isArray(value.phases) ? value.phases : []).slice(0,32).forEach(function(phase) {
      if (!phase || names.indexOf(phase.name) === -1) return;
      var next = {name:phase.name};
      "durationMs elapsedMs templateFileCount containerCount templateVolumeCount projectCount fileCount protectedPathCount filesystemVolumeCount directChildDirectoryCount beforeCount afterCount rowCount".split(" ").forEach(function(key) {
        if (typeof phase[key] === "number" && isFinite(phase[key])) next[key] = Math.max(0, Math.min(100000000, Math.floor(phase[key])));
      });
      "dockerRunning engineReachable truncated rootMounted uncertain dockerInventoryUnverified composeInventoryUncertain snapshotWritten".split(" ").forEach(function(key) {
        if (typeof phase[key] === "boolean") next[key] = phase[key];
      });
      result.phases.push(next);
    });
    return result;
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

    if (/^(?:[A-Za-z]:[\\/]|\\)/.test(raw)) {
      sanitized = getDiagnosticsAlias(redactor, "segment", raw, "path");
      registerDiagnosticsReplacement(redactor, raw, sanitized);
      return sanitized;
    }

    if (raw.charAt(0) !== "/") {
      return sanitizeDiagnosticsFreeText(raw, redactor);
    }

    segments = raw.split("/");
    sanitizedSegments = segments.slice(0);
    var root = String(segments[1] || "").toLowerCase();
    var safeRoot = /^(mnt|boot|config|data|downloads|media|cache|tmp|temp|transcode|movies|tv|music|backup|backups|home|root|srv|opt|var|etc|usr)$/.test(root);
    $.each(segments, function(index, segment) {
      if (!segment || /^<(?:audit-)?(?:path|mount|share|app|name|container|dataset|snapshot|row|template)(?:-\d+)?>(?:\.xml)?$/.test(segment)) return;
      if (index === 1 && safeRoot) return;
      if (root === "mnt" && index === 2 && /^(user|user0|cache|disk\d+)$/i.test(segment)) return;
      if (root === "mnt" && index === 3 && /^(appdata|system|domains|isos)$/i.test(segment)) return;
      if (root === "boot" && index === 2 && segment === "config") return;
      if (root === "boot" && index === 3 && segments[2] === "config" && segment === "plugins") return;
      var kind = root === "mnt" && index === 2 ? "mount" : (root === "mnt" && index === 3 ? "share" : "segment");
      sanitizedSegments[index] = getDiagnosticsAlias(redactor, kind, segment, kind === "segment" ? "path" : kind);
      registerDiagnosticsReplacement(redactor, segment, sanitizedSegments[index]);
    });
    sanitized = sanitizedSegments.join("/");
    registerDiagnosticsReplacement(redactor, raw, sanitized);
    return sanitized;
  }

  function sanitizeDiagnosticsTemplateRefs(templateRefs, redactor) {
    return $.map($.isArray(templateRefs) ? templateRefs : [], function(ref) {
      var record = $.isPlainObject(ref) ? $.extend({}, ref) : {};

      record.name = sanitizeDiagnosticsName(record.name || "", redactor, "app");
      record.file = sanitizeDiagnosticsTemplateFile(record.file || "", redactor);
      record.target = sanitizeDiagnosticsPath(record.target || "", redactor);
      return record;
    });
  }

  function sanitizeDiagnosticsMountEvidence(evidence, redactor) {
    return $.map(($.isArray(evidence) ? evidence : []).slice(0, 50), function(entry) {
      entry = entry || {};
      return {
        name: sanitizeDiagnosticsName(entry.name || "", redactor, "container"),
        paths: $.map(($.isArray(entry.paths) ? entry.paths : []).slice(0, 50), function(path) {
          return sanitizeDiagnosticsPath(path, redactor);
        })
      };
    });
  }

  function buildDiagnosticsDecision(row) {
    var evidence = [];
    var blockers = [];
    var specific = $.isArray(row.mountEvidence) ? row.mountEvidence.length : 0;
    var broad = $.isArray(row.broadMountEvidence) ? row.broadMountEvidence.length : 0;
    var source = row.sourceKind === "filesystem" ? "discovery" : (row.sourceKind === "template" ? "template" : "unknown");
    var zfsUnavailable = row.storageKind === "zfs_unavailable" || row.zfsResolutionKind === "zfs_unavailable";
    var storage = zfsUnavailable ? "unavailable" : (row.storageKind === "zfs" ? "exact_dataset" : (["filesystem", "folder"].indexOf(row.storageKind) !== -1 ? "folder" : "unknown"));
    evidence.push(source, storage);
    if (zfsUnavailable) { evidence.push("zfs_unavailable"); blockers.push("zfs_unavailable"); }
    if (storage === "unknown") evidence.push("storage_unknown");
    if (row.zfsMappingMatched && row.zfsResolutionKind === "mapped_no_exact_mountpoint" && storage === "folder") evidence.push("mapping_without_exact_dataset");
    if (specific) { evidence.push("specific_mount"); blockers.push("specific_mount"); }
    if (broad) evidence.push("broad_access");
    if (row.scanVerificationLocked) blockers.unshift("ownership_unverified");
    if (row.securityLockReason) {
      var mountReason = diagnosticsMountReasonCode(row.mountReasonCode);
      blockers.push(["mount_inventory_unavailable", "mount_inventory_empty", "mount_inventory_invalid", "filesystem_metadata_failed"].indexOf(mountReason) !== -1 ? mountReason : (["symlink", "mount_point", "root_path", "unsafe_path"].indexOf(row.securityReasonCode) !== -1 ? row.securityReasonCode : "protected_path"));
    }
    if (row.policyLocked) blockers.push(["permanent_delete", "zfs_disabled"].indexOf(row.policyReasonCode) !== -1 ? row.policyReasonCode : "policy_lock");
    if (storage === "unknown" && !row.canDelete) blockers.push("storage_unknown");
    if (!row.canDelete && !blockers.length) blockers.push("not_actionable");
    return {source:source, storage:storage, evidence:evidence, blockers:blockers, primaryBlocker:blockers[0] || "none", specificMountCount:specific, broadAccessCount:broad, ignored:!!row.ignored};
  }

  function sanitizeDiagnosticsRow(row, redactor) {
    var nextRow = $.extend(true, {}, row || {});
    nextRow.mountEvidence = sanitizeDiagnosticsMountEvidence(nextRow.mountEvidence, redactor);
    nextRow.broadMountEvidence = sanitizeDiagnosticsMountEvidence(nextRow.broadMountEvidence, redactor);

    nextRow.id = sanitizeDiagnosticsRowId(nextRow.id || "", redactor);
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
    nextRow.decision = buildDiagnosticsDecision(row || {});
    nextRow.storageDetail = sanitizeDiagnosticsFreeText(nextRow.storageDetail || "", redactor);
    nextRow.zfsResolutionMessage = sanitizeDiagnosticsFreeText(nextRow.zfsResolutionMessage || "", redactor);
    nextRow.zfsResolutionDetail = sanitizeDiagnosticsFreeText(nextRow.zfsResolutionDetail || "", redactor);
    nextRow.zfsMatchedShareRoot = sanitizeDiagnosticsPath(nextRow.zfsMatchedShareRoot || "", redactor);
    nextRow.zfsMatchedDatasetRoot = sanitizeDiagnosticsPath(nextRow.zfsMatchedDatasetRoot || "", redactor);
    nextRow.zfsResolutionVariants = $.map($.isArray(nextRow.zfsResolutionVariants) ? nextRow.zfsResolutionVariants : [], function(path) {
      return sanitizeDiagnosticsPath(path, redactor);
    });
    nextRow.zfsImpactSummary = sanitizeDiagnosticsFreeText(nextRow.zfsImpactSummary || "", redactor);
    nextRow.zfsChildDatasets = $.map($.isArray(nextRow.zfsChildDatasets) ? nextRow.zfsChildDatasets : [], function(name) {
      return sanitizeDiagnosticsName(name, redactor, "dataset");
    });
    nextRow.zfsSnapshots = $.map($.isArray(nextRow.zfsSnapshots) ? nextRow.zfsSnapshots : [], function(name) {
      return sanitizeDiagnosticsName(name, redactor, "snapshot");
    });
    nextRow.zfsPreviewError = sanitizeDiagnosticsFreeText(nextRow.zfsPreviewError || "", redactor);
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
    // Keep audit ZFS replacements separate from the generic redactor so a
    // dataset named like a status code cannot change machine-readable fields.
    var zfsRedactor = buildDiagnosticsRedactor();
    var zfsName = function(value, label) {
      if (typeof value !== "string") return "";
      if (/^<(?:audit-)?(?:dataset|snapshot)-\d+>$/.test(value)) return value;
      return sanitizeDiagnosticsName(value, zfsRedactor, label);
    };
    $.each($.isArray(history) ? history : [], function(_, entry) {
      $.each($.isArray(entry && entry.results) ? entry.results : [], function(_, result) {
        result = result || {};
        zfsName(result.datasetName, "audit-dataset");
        $.each($.isArray(result.zfsChildDatasets) ? result.zfsChildDatasets : [], function(_, value) { zfsName(value, "audit-dataset"); });
        $.each($.isArray(result.zfsSnapshots) ? result.zfsSnapshots : [], function(_, value) { zfsName(value, "audit-snapshot"); });
      });
    });
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
        if (Object.prototype.hasOwnProperty.call(nextResult, "datasetName")) nextResult.datasetName = zfsName(nextResult.datasetName, "audit-dataset");
        if (Object.prototype.hasOwnProperty.call(nextResult, "datasetMountpoint")) nextResult.datasetMountpoint = sanitizeDiagnosticsPath(nextResult.datasetMountpoint, redactor);
        ["zfsChildDatasets", "zfsSnapshots"].forEach(function(field) {
          if (Object.prototype.hasOwnProperty.call(nextResult, field)) nextResult[field] = $.map($.isArray(nextResult[field]) ? nextResult[field] : [], function(value) { return zfsName(value, field === "zfsSnapshots" ? "audit-snapshot" : "audit-dataset"); });
        });
        if (Object.prototype.hasOwnProperty.call(nextResult, "zfsImpactSummary")) nextResult.zfsImpactSummary = sanitizeDiagnosticsFreeText(sanitizeDiagnosticsFreeText(nextResult.zfsImpactSummary, zfsRedactor), redactor);
        nextResult.message = sanitizeDiagnosticsFreeText(sanitizeDiagnosticsFreeText(nextResult.message || "", zfsRedactor), redactor);
        delete nextResult.id;
        delete nextResult.row;
        return nextResult;
      });
      delete nextEntry.requestedIds;
      nextEntry.message = sanitizeDiagnosticsFreeText(sanitizeDiagnosticsFreeText(nextEntry.message || "", zfsRedactor), redactor);

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
    nextInfo.zfsPathMappingSuggestions = $.map($.isArray(nextInfo.zfsPathMappingSuggestions) ? nextInfo.zfsPathMappingSuggestions : [], function(mapping) {
      return {
        shareRoot: sanitizeDiagnosticsPath(mapping && mapping.shareRoot, redactor),
        datasetRoot: sanitizeDiagnosticsPath(mapping && mapping.datasetRoot, redactor),
        datasetName: sanitizeDiagnosticsName(mapping && mapping.datasetName, redactor, "dataset")
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
    diagnosticsExportRedactor = redactor;
    var sanitizedInsights = $.extend(true, {}, buildScanInsights());
    var rowLimit = 500;
    var sanitizedRows = [];
    $.each(state.rows || [], function(index, row) {
      // Register identifiers from omitted rows too, so their names cannot
      // survive in other evidence while the exported row list stays bounded.
      var sanitizedRow = sanitizeDiagnosticsRow(row, redactor);
      if (index < rowLimit) sanitizedRows.push(sanitizedRow);
    });
    var sanitizedSettings = sanitizeDiagnosticsSettings(state.settings || {}, redactor);
    var sanitizedSourceInfo = sanitizeDiagnosticsSourceInfo(state.appdataSources || {}, redactor);
    var sanitizedAuditHistory = sanitizeDiagnosticsAuditHistory(($.isArray(state.auditHistory) ? state.auditHistory : []).slice(0, 25), redactor);

    sanitizedInsights.scanRoots = $.map($.isArray(sanitizedInsights.scanRoots) ? sanitizedInsights.scanRoots : [], function(path) {
      return sanitizeDiagnosticsPath(path, redactor);
    });

    var payload = {
      schemaVersion: 5,
      generatedAt: generatedAt.toISOString(),
      pluginVersion: String(config.pluginVersion || ""),
      redaction: {
        sanitized: true,
        version: 3,
        strategy: "Sensitive values are scrubbed recursively; paths, names, template filenames, and row identifiers use export-scoped aliases."
      },
      hostTheme: {
        name: ACP.resolveHostThemeName ? ACP.resolveHostThemeName() : "",
        themeClass: ACP.inferThemeClass ? ACP.inferThemeClass(ACP.resolveHostThemeName ? ACP.resolveHostThemeName() : "") : ""
      },
      browser: captureDiagnosticsBrowser(),
      activity: buildDiagnosticsActivity(),
      localization: {
        locale: /^[a-z]{2}_[A-Z]{2}$/.test(config.locale || "") ? config.locale : "unknown",
        languageTag: /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/.test(config.languageTag || "") ? config.languageTag : "unknown",
        direction: config.direction === "rtl" ? "rtl" : "ltr",
        viewport: {width:Math.max(0, Math.min(20000, window.innerWidth || 0)), height:Math.max(0, Math.min(20000, window.innerHeight || 0))},
        capabilities: {numberFormat:!!(window.Intl && window.Intl.NumberFormat), pluralRules:!!(window.Intl && window.Intl.PluralRules), relativeTimeFormat:!!(window.Intl && window.Intl.RelativeTimeFormat), dateTimeFormat:!!(window.Intl && window.Intl.DateTimeFormat)}
      },
      recentFailures: {status:diagnosticsFailureTotal > diagnosticsFailures.length ? "partial" : "complete", totalCount:diagnosticsFailureTotal, includedCount:diagnosticsFailures.length, omittedCount:diagnosticsFailureTotal - diagnosticsFailures.length, data:diagnosticsFailures.slice()},
      collection: {status:"complete", sections:{browser:{status:"complete"}, rows:{status:(state.rows || []).length > rowLimit ? "partial" : "complete",limit:rowLimit,includedCount:sanitizedRows.length,omittedCount:Math.max(0,(state.rows || []).length-sanitizedRows.length)}, auditHistory:{status:(state.auditHistory || []).length > 25 ? "partial" : "complete",includedCount:sanitizedAuditHistory.length,omittedCount:Math.max(0,(state.auditHistory || []).length - sanitizedAuditHistory.length)}}},
      uiState: {
        dialog: captureDiagnosticsUi(),
        fixtureTools: {
          statusLoaded: !!state.fixtureTools.status,
          loading: !!state.fixtureTools.loading,
          requestFailed: state.fixtureTools.ok === false,
          rootAvailable: !!(state.fixtureTools.status && state.fixtureTools.status.root),
          rootReason: diagnosticsFixtureRootReason(state.fixtureTools.status)
        },
        searchActive: !!$.trim(String(els.$search.val() || "")),
        searchLength: $.trim(String(els.$search.val() || "")).length,
        sortMode: String(state.sortMode || "name"),
        busy: !!state.busy
      },
      scan: {
        dockerRunning: !!state.dockerRunning,
        scanTokenPresent: !!state.scanToken,
        scanWarningMessage: sanitizeDiagnosticsFreeText(String(state.scanWarningMessage || ""), redactor),
        scanVerification: state.scanVerification,
        verificationLocks: (state.rows || []).filter(function(row) { return !!row.scanVerificationLocked; }).length,
        protectionLocks: (state.rows || []).filter(function(row) { return !!row.securityLockReason; }).length,
        summary: $.extend({}, state.summary || {}),
        metrics: sanitizeDiagnosticsScanMetrics(state.scanMetrics),
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
      notices: $.map(notices, function(notice) {
        return {
          type: String((notice && notice.type) || ""),
          title: sanitizeDiagnosticsFreeText((notice && notice.title) || "", redactor),
          message: sanitizeDiagnosticsFreeText((notice && notice.message) || "", redactor)
        };
      }),
      auditHistory: sanitizedAuditHistory,
      rows: sanitizedRows,
      visibleRowIds: $.map(visibleRows.slice(0, rowLimit), function(row) {
        return row && row.id ? sanitizeDiagnosticsRowId(row.id, redactor) : null;
      }),
      selectedRowIds: $.map(selectedRows.slice(0, rowLimit), function(row) {
        return row && row.id ? sanitizeDiagnosticsRowId(row.id, redactor) : null;
      })
    };

    if (!state.auditHistoryLoaded) payload.collection.sections.auditHistory.status = "unavailable";
    else if (state.auditHistoryHasMore) { payload.collection.sections.auditHistory.status = "partial"; payload.collection.sections.auditHistory.omittedCount = null; }
    if (!state.scanToken && !(state.scanMetrics && state.scanMetrics.startedAt)) payload.collection.sections.rows.status = "unavailable";
    payload.collection.sections.recentFailures = {status:payload.recentFailures.status,includedCount:payload.recentFailures.includedCount,omittedCount:payload.recentFailures.omittedCount};
    payload.collection.sections.activity = {status:payload.activity.status,includedCount:payload.activity.includedCount,omittedCount:payload.activity.omittedCount};
    payload.collection.sections.visibleRows = {status:visibleRows.length > rowLimit ? "partial" : "complete",includedCount:payload.visibleRowIds.length,omittedCount:Math.max(0,visibleRows.length-payload.visibleRowIds.length)};
    payload.collection.sections.selectedRows = {status:selectedRows.length > rowLimit ? "partial" : "complete",includedCount:payload.selectedRowIds.length,omittedCount:Math.max(0,selectedRows.length-payload.selectedRowIds.length)};
    payload.browserCapturedAt = generatedAt.toISOString();
    return sanitizeDiagnosticsValue(payload, redactor, "");
  }

  function buildDiagnosticsFilename() {
    var stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
    return "appdata-cleanup-plus-diagnostics-" + stamp + ".json";
  }

  function extractServerLatestScanMetrics(bundle) {
    var metricsFile = bundle && bundle.state && bundle.state.latestScanMetrics;
    var metrics = metricsFile && metricsFile.data;

    if (metrics && typeof metrics.startedAt === "string") {
      return sanitizeDiagnosticsScanMetrics(metrics);
    }

    return {};
  }

  function buildDiagnosticsTroubleshootingOverview(payload, serverBundle) {
    var troubleshooting = (serverBundle && serverBundle.troubleshooting) || {};
    var overview = troubleshooting.overview || {};
    var checks = $.isArray(troubleshooting.checks) ? troubleshooting.checks : [];

    return {
      status: String(overview.status || "unknown"),
      headline: sanitizeDiagnosticsFreeText(String(overview.headline || ""), buildDiagnosticsRedactor()),
      statusCounts: $.extend({ ok: 0, info: 0, warning: 0, error: 0 }, overview.statusCounts || {}),
      findings: $.map(checks, function(check) {
        if (!check || (check.status !== "warning" && check.status !== "error")) {
          return null;
        }

        return {
          id: String(check.id || "check"),
          status: String(check.status || "info"),
          summary: sanitizeDiagnosticsFreeText(String(check.summary || ""), buildDiagnosticsRedactor()),
          details: sanitizeDiagnosticsValue(check.details || {}, buildDiagnosticsRedactor(), "")
        };
      }).slice(0, 20),
      clientState: {
        dockerRunning: !!(payload && payload.scan && payload.scan.dockerRunning),
        scanWarningPresent: !!(payload && payload.scan && payload.scan.scanWarningMessage),
        rowCount: payload && $.isArray(payload.rows) ? payload.rows.length : 0,
        visibleRowCount: Number((payload && payload.scan && payload.scan.visibleRowCount) || 0),
        selectedRowCount: Number((payload && payload.scan && payload.scan.selectedRowCount) || 0),
        pendingStatCount: Number((payload && payload.scan && payload.scan.pendingStatCount) || 0)
      }
    };
  }


  function copyTextToClipboard(text) {
    var deferred = $.Deferred();
    var payload = String(text || "");

    if (!payload) {
      deferred.reject(new Error("empty"));
      return deferred.promise();
    }

    function fallbackCopy() {
      var textarea = document.createElement("textarea");
      var success = false;

      textarea.value = payload;
      textarea.setAttribute("readonly", "readonly");
      textarea.style.position = "fixed";
      textarea.style.top = "-9999px";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      try {
        success = document.execCommand("copy");
      } catch (_copyError) {
        success = false;
      }

      document.body.removeChild(textarea);

      if (success) {
        deferred.resolve();
      } else {
        deferred.reject(new Error("copy"));
      }
    }

    if (window.navigator && window.navigator.clipboard && typeof window.navigator.clipboard.writeText === "function") {
      window.navigator.clipboard.writeText(payload).then(function() {
        deferred.resolve();
      }).catch(function() {
        fallbackCopy();
      });
    } else {
      fallbackCopy();
    }

    return deferred.promise();
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

  function diagnosticsVersion(value) {
    return /^\d{4}\.\d{2}\.\d{2}\.\d{2}$/.test(String(value || "")) ? String(value) : "unknown";
  }

  function buildDiagnosticsSupportSummary(payload) {
    var overview = payload.troubleshooting || {};
    var health = ["ok","warning","error","unknown"].indexOf(overview.status) !== -1 ? overview.status : "unknown";
    var limitations = [];
    var serverSections = ((payload.serverDiagnostics || {}).collection || {}).sections || {};
    var hasServerLimits = Object.keys(serverSections).slice(0, 50).some(function(key) {
      return (serverSections[key] || {}).status !== "complete";
    });
    var sectionNames = "browser rows visibleRows selectedRows auditHistory recentFailures activity server runtime currentSnapshot troubleshooting fixtureRoot safetySettings quarantineRegistry ignoredCandidates runtimeLocks statsCache mountInventoryCurrent latestScanMetrics snapshots".split(" ");
    function addLimits(sections, omitServerAggregate) {
      Object.keys(sections || {}).slice(0, 50).forEach(function(key) {
        var section = sections[key] || {};
        if (section.status === "complete") return;
        if (omitServerAggregate && key === "server" && section.status === "partial" && section.category === "none") return;
        var name = sectionNames.indexOf(key) !== -1 || /^log-(?:[1-9]|10)$/.test(key) ? key : "other";
        var reason = section.omissionReason || section.category || (section.status === "partial" ? "bounded_collection" : "source_unavailable");
        if ("bounded_collection record_limit byte_limit size_limit invalid_records source_unavailable collection_failed request_failed invalid_response not_loaded".split(" ").indexOf(reason) === -1) reason = "unknown";
        limitations.push({section:name,reason:reason});
      });
    }
    addLimits((payload.collection || {}).sections, hasServerLimits);
    addLimits(serverSections);
    var findings = (overview.findings || []).slice(0, 20).map(function(finding) {
      var id = /^[a-zA-Z0-9_-]{1,64}$/.test(String(finding.id || "")) ? String(finding.id) : "check";
      var nextStep = id === "versionMatch" ? "reload" : (["scanMatch","current-snapshot","latest-scan"].indexOf(id) !== -1 ? "rescan" : (id === "collection" || id === "state-files" ? "review_collection" : "review_diagnostics"));
      return {id:id,severity:["warning","error","info"].indexOf(finding.status) !== -1 ? finding.status : "info",summary:String(finding.summary || ""),nextStep:nextStep};
    });
    var counts = (payload.scan || {}).summary || {};
    var rows = (payload.collection || {}).sections && payload.collection.sections.rows || {};
    function knownCount(value) { return typeof value === "number" && isFinite(value) && value >= 0 ? diagnosticsBoundedNumber(value,1000000) : null; }
    return {status:(payload.collection || {}).status === "complete" ? "complete" : "partial",health:health,
      headline:health === "error" || health === "warning" ? "Review the diagnostic findings before acting." : "Diagnostic evidence is ready for review.",
      generatedAt:payload.browserCapturedAt || payload.generatedAt,completedAt:payload.completedAt,
      versions:{browser:(payload.freshness || {}).browserVersion || "unknown",server:(payload.freshness || {}).serverVersion || "unknown",match:(payload.freshness || {}).versionMatch || "unknown"},
      freshness:{scanMatch:(payload.freshness || {}).scanMatch || "unknown",currentSnapshot:((payload.freshness || {}).currentSnapshot || {}).status || "unknown"},
      counts:{detected:knownCount(counts.total),visible:knownCount((payload.scan || {}).visibleRowCount),selected:knownCount((payload.scan || {}).selectedRowCount),blocked:knownCount(counts.blocked),reportedRows:(payload.rows || []).length,omittedRows:knownCount(rows.omittedCount),failedRequests:knownCount((payload.recentFailures || {}).totalCount),activityEvents:knownCount((payload.activity || {}).includedCount),omittedEvents:knownCount((payload.activity || {}).omittedCount)},
      findings:findings,limitations:limitations.slice(0, 30)};
  }

  function refreshDiagnosticsExportUi() {
    if (isToolsModalVisible()) {
      try { renderToolsModal(); }
      catch (_error) { recordDiagnosticsActivity("javascript_error", {module:"main"}); }
    }
  }

  function prepareDiagnosticsExport(payload, serverBundle, failure) {
    var serverAvailable = !!(serverBundle && typeof serverBundle === "object" && [4,5].indexOf(serverBundle.schemaVersion) !== -1);
    var serverRedactor = diagnosticsExportRedactor || buildDiagnosticsRedactor();
    var serverCopy = serverAvailable ? $.extend(true, {}, serverBundle) : {};
    if (serverCopy.state && $.isArray(serverCopy.state.auditHistory)) serverCopy.state.auditHistory = sanitizeDiagnosticsAuditHistory(serverCopy.state.auditHistory, serverRedactor);
    payload.serverDiagnostics = sanitizeDiagnosticsValue(serverCopy, serverRedactor, "");
    payload.collection.sections.server = {status:serverAvailable ? ((serverBundle.collection || {}).status || "partial") : "failed", category:serverAvailable ? "none" : (failure === "invalid_response" ? "invalid_response" : "request_failed")};
    var browserVersion = diagnosticsVersion(payload.pluginVersion);
    var serverVersion = diagnosticsVersion(serverBundle && serverBundle.runtime && serverBundle.runtime.pluginVersion);
    var serverMetrics = extractServerLatestScanMetrics(serverBundle);
    var browserScan = payload.scan && payload.scan.metrics && payload.scan.metrics.startedAt;
    var serverScan = serverMetrics.startedAt;
    payload.freshness = {
      browserVersion:browserVersion, serverVersion:serverVersion,
      versionMatch:browserVersion === "unknown" || serverVersion === "unknown" ? "unknown" : (browserVersion === serverVersion ? "match" : "mismatch"),
      scanMatch:!isFinite(Date.parse(browserScan)) || !isFinite(Date.parse(serverScan)) ? "unknown" : (Date.parse(browserScan) === Date.parse(serverScan) ? "match" : "mismatch"),
      currentSnapshot:serverAvailable && serverBundle.currentSnapshot ? serverBundle.currentSnapshot : {status:"unavailable"}
    };
    payload.troubleshooting = buildDiagnosticsTroubleshootingOverview(payload, payload.serverDiagnostics);
    var serverFindingCount = payload.troubleshooting.findings.length;
    ["versionMatch", "scanMatch"].forEach(function(key) {
      if (payload.freshness[key] === "mismatch") payload.troubleshooting.findings.push({id:key,status:"warning",summary:key === "versionMatch" ? "Browser and server plugin versions differ; reload the page." : "Browser and server scan times differ; rescan before acting."});
    });
    if (["expired", "invalid", "missing", "unreadable"].indexOf(payload.freshness.currentSnapshot.status) !== -1) payload.troubleshooting.findings.push({id:"current-snapshot",status:"warning",summary:"The current browser scan snapshot cannot be used; rescan before acting."});
    payload.recentFailures = {status:diagnosticsFailureTotal > diagnosticsFailures.length ? "partial" : "complete",totalCount:diagnosticsFailureTotal,includedCount:diagnosticsFailures.length,omittedCount:diagnosticsFailureTotal-diagnosticsFailures.length,data:diagnosticsFailures.slice()};
    payload.recentFailures.captureStartedAt = diagnosticsCaptureStartedAt;
    payload.collection.sections.recentFailures = {status:payload.recentFailures.status,includedCount:payload.recentFailures.includedCount,omittedCount:payload.recentFailures.omittedCount};
    var partial = Object.keys(payload.collection.sections).some(function(key) { return payload.collection.sections[key].status !== "complete"; });
    payload.collection.status = partial ? "partial" : "complete";
    var collectionProblem = Object.keys(payload.collection.sections).some(function(key) {
      var section = payload.collection.sections[key];
      return section.status === "failed" || (key === "rows" && section.status === "unavailable");
    });
    var serverSections = (payload.serverDiagnostics.collection || {}).sections || {};
    collectionProblem = collectionProblem || Object.keys(serverSections).some(function(key) {
      var section = serverSections[key];
      return section.status === "failed" || Number(section.invalidRecordCount || 0) > 0 || ["invalid_records","size_limit"].indexOf(section.omissionReason) !== -1 || (["runtime", "currentSnapshot", "latestScanMetrics", "troubleshooting"].indexOf(key) !== -1 && ["partial", "unavailable"].indexOf(section.status) !== -1);
    });
    if (collectionProblem) payload.troubleshooting.findings.push({id:"collection",status:"warning",summary:"Required diagnostics evidence is missing or a collector failed; inspect collection status."});
    payload.troubleshooting.statusCounts.warning += payload.troubleshooting.findings.length - serverFindingCount;
    if (payload.troubleshooting.statusCounts.warning > 0 && payload.troubleshooting.status !== "error") {
      payload.troubleshooting.status = "warning";
      payload.troubleshooting.headline = "Diagnostics contain incomplete evidence or conditions worth reviewing.";
    }
    recordDiagnosticsActivity("export_collected", {action:"getDiagnosticsBundle"});
    payload.completedAt = new Date().toISOString();
    payload.activity = buildDiagnosticsActivity();
    payload.collection.sections.activity = {status:payload.activity.status,includedCount:payload.activity.includedCount,omittedCount:payload.activity.omittedCount};
    if (payload.activity.status === "partial") payload.collection.status = "partial";
    payload.uiState = payload.uiState || {};
    payload.uiState.exportCompletion = captureDiagnosticsUi();
    payload = sanitizeDiagnosticsValue(payload, serverRedactor, "");
    payload.supportSummary = buildDiagnosticsSupportSummary(payload);
    payload = sanitizeDiagnosticsValue(payload, serverRedactor, "");
    return payload;
  }

  function completeDiagnosticsExport(payload, serverBundle, failure) {
    try { payload = prepareDiagnosticsExport(payload, serverBundle, failure); }
    catch (_error) {
      recordDiagnosticsActivity("export_failed", {reason:"invalid_response"});
      try { payload = prepareDiagnosticsExport(payload, null, "invalid_response"); }
      catch (_fallbackError) {
        diagnosticsExportState = {loading:false,result:"failed",summary:null};
        diagnosticsExportRedactor = null;
        refreshDiagnosticsExportUi();
        return;
      }
    }
    try {
      downloadJsonFile(buildDiagnosticsFilename(), payload);
      recordDiagnosticsActivity("export_completed", {action:"getDiagnosticsBundle"});
      diagnosticsExportState = {loading:false,result:"downloaded",summary:payload.supportSummary};
    } catch (_error) {
      recordDiagnosticsActivity("export_failed", {reason:"download_failed"});
      diagnosticsExportState = {loading:false,result:"failed",summary:payload.supportSummary};
    }
    diagnosticsExportRedactor = null;
    refreshDiagnosticsExportUi();
  }

  function exportDiagnostics() {
    if (diagnosticsExportState.loading) {
      recordDiagnosticsActivity("export_ignored", {reason:"already_running"});
      return;
    }
    diagnosticsExportState = {loading:true,result:diagnosticsExportState.result,summary:diagnosticsExportState.summary};
    diagnosticsExportRedactor = null;
    recordDiagnosticsActivity("export_started", {action:"getDiagnosticsBundle"});
    refreshDiagnosticsExportUi();
    var payload;
    try { payload = buildDiagnosticsPayload(); }
    catch (_error) { payload = {schemaVersion:5,generatedAt:new Date().toISOString(),pluginVersion:diagnosticsVersion(config.pluginVersion),redaction:{sanitized:true,version:3},collection:{status:"partial",sections:{browser:{status:"failed",category:"collection_failed"}}},scan:{},rows:[]}; }
    var request;
    try { request = apiPostForUserAction({
      action: "getDiagnosticsBundle",
      scanToken: state.scanToken || ""
    }); } catch (_error) {
      recordDiagnosticsFailure("getDiagnosticsBundle",0,"error",0);
      completeDiagnosticsExport(payload,null,"request_failed");
      return;
    }
    request.done(function(response) {
      completeDiagnosticsExport(payload, response && response.ok && response.bundle, "invalid_response");
    }).fail(function(xhr) {
      completeDiagnosticsExport(payload, null, "request_failed");
    });
  }


  function updateFixtureToolsFromResponse(response, fallbackMessage, ok) {
    state.fixtureTools = $.extend({}, state.fixtureTools || {}, {
      loading: false,
      ok: typeof ok === "boolean" ? ok : !!(response && response.ok),
      message: String((response && response.message) || fallbackMessage || ""),
      status: response && response.status ? response.status : ((state.fixtureTools || {}).status || null)
    });
  }

  function runTemplateManagerAction(managerAction, id, extraData) {
    state.templateManager.loading = true;
    state.templateManager.message = ACP.tr("Loading saved templates.");
    renderTemplateManagerModal();
    apiPostForUserAction($.extend({action: "templateManagerAction", managerAction: managerAction, templateId: id}, extraData || {})).done(function(response) {
      if (managerAction === "export") {
        state.templateManager.loading = false;
        try {
          if (!response.backupArchive || response.backupArchive.format !== "appdata-cleanup-plus-template-backups") throw new Error("invalid backup");
          downloadJsonFile("appdata-cleanup-plus-private-template-backups.json", response.backupArchive);
          state.templateManager.message = ACP.tr("Private backups exported. Keep this file secure and do not share it in support reports.");
        } catch (_error) { state.templateManager.message = ACP.tr("The backup export could not be downloaded."); }
        if (isTemplateManagerModalVisible()) renderTemplateManagerModal();
        return;
      }
      state.templateManager = {loading: false, status: response.templateManager, message: response.message || "", selected: state.templateManager.selected};
      if (isTemplateManagerModalVisible()) renderTemplateManagerModal();
      if (managerAction === "archive" || managerAction === "restore") loadScan();
    }).fail(function(xhr) {
      var response = (xhr && xhr.responseJSON) || {};
      state.templateManager.loading = false;
      if (response.templateManager) state.templateManager.status = response.templateManager;
      state.templateManager.message = ACP.extractErrorMessage(xhr, ACP.tr("The template action could not be completed. Refresh the list and try again."));
      if (isTemplateManagerModalVisible()) renderTemplateManagerModal();
    });
  }

  function isFixtureMutationPending() {
    return fixtureToolsPendingAction === "create" || fixtureToolsPendingAction === "remove";
  }

  function runFixtureManagerAction(managerAction) {
    if (isFixtureMutationPending()) return;
    var requestVersion = ++fixtureToolsRequestVersion;
    fixtureToolsPendingAction = managerAction;
    state.fixtureTools = $.extend({}, state.fixtureTools || {}, {
      loading: true,
      message: ACP.t(strings, "toolsFixtureWorkingMessage", "Working on test fixtures.")
    });
    renderToolsModal();

    apiPostForUserAction({
      action: "fixtureManagerAction",
      managerAction: managerAction
    }).done(function(response) {
      if (requestVersion !== fixtureToolsRequestVersion) {
        recordDiagnosticsActivity("response_ignored", {action:"fixtureManagerAction",fixtureAction:managerAction,reason:"superseded"});
        return;
      }
      fixtureToolsPendingAction = "";
      updateFixtureToolsFromResponse(response, ACP.t(strings, "toolsFixtureDoneMessage", "Test fixture action completed."), true);
      if (managerAction === "status" && !(response && response.status)) state.fixtureTools.status = null;
      if (isToolsModalVisible()) renderToolsModal();

      if (managerAction === "create" || managerAction === "remove") {
        loadScan();
      }
    }).fail(function(xhr) {
      if (requestVersion !== fixtureToolsRequestVersion) {
        recordDiagnosticsActivity("response_ignored", {action:"fixtureManagerAction",fixtureAction:managerAction,reason:"superseded"});
        return;
      }
      fixtureToolsPendingAction = "";
      updateFixtureToolsFromResponse(xhr && xhr.responseJSON, ACP.extractErrorMessage(xhr, ACP.t(strings, "toolsFixtureFailedMessage", "The test fixture action could not be completed right now.")), false);
      if (managerAction === "status" && !(xhr && xhr.responseJSON && xhr.responseJSON.status)) state.fixtureTools.status = null;
      if (isToolsModalVisible()) renderToolsModal();
    });
  }

  function getFilteredAuditHistoryForCopy() {
    if (typeof ACP.filterAuditHistoryEntries === "function") {
      return ACP.filterAuditHistoryEntries(state.auditHistory || [], state.auditQuery || "");
    }

    return $.isArray(state.auditHistory) ? state.auditHistory : [];
  }

  function buildAuditSummaryText() {
    var entries = getFilteredAuditHistoryForCopy();
    var lines = [
      ACP.tr("Appdata Cleanup Plus audit history"),
      ACP.tr("Entries: {count}", {count: entries.length}),
      state.auditQuery ? ACP.tr("Filter: {query}", {query: state.auditQuery}) : ""
    ];

    $.each(entries, function(_, entry) {
      var summary = entry.summary || {};
      var counts = [];

      $.each(summary, function(status, count) {
        if (Number(count || 0) > 0) {
          counts.push(ACP.formatOperationResultStatus(strings, status === "conflicts" ? "conflict" : (status === "errors" ? "error" : status)).label + "=" + ACP.formatCount(count));
        }
      });

      lines.push("");
      lines.push((entry.operationLabel || ACP.tr("Action")) + " - " + (entry.timestampLabel || entry.timestamp || ACP.tr("unknown time")));
      if (entry.message) {
        lines.push(entry.message);
      }
      if (counts.length) {
        lines.push(ACP.tr("Summary: {summary}", {summary: counts.join(", ")}));
      }

      $.each($.isArray(entry.pathsPreview) ? entry.pathsPreview : [], function(_, preview) {
        lines.push("- " + ACP.formatOperationResultStatus(strings, preview.status).label + ": " + String(preview.path || ""));
      });
    });

    return $.grep(lines, function(line) {
      return line !== "";
    }).join("\n");
  }

  function copyAuditSummary() {
    copyTextToClipboard(buildAuditSummaryText()).done(function() {
      state.auditQuery = state.auditQuery || "";
      if (state.auditOpen) {
        renderAuditHistoryModal();
      }
    }).fail(function() {
      swal(
        ACP.t(strings, "auditHistoryCopyFailedTitle", "Audit summary failed"),
        ACP.t(strings, "auditHistoryCopyFailedMessage", "The audit summary could not be copied right now."),
        "error"
      );
    });
  }

  function reconcileQuarantineSelection() {
    var allowed = {};

    $.each(state.quarantine.entries || [], function(_, entry) {
      var entryId = String(entry.id || "");

      if (entryId && entry.restoreStatus !== "missing") {
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

      if (entryId && entry.restoreStatus !== "missing" && state.quarantine.selected[entryId]) {
        selectedIds.push(entryId);
      }
    });

    return selectedIds;
  }

  function selectAllQuarantineEntries() {
    $.each(state.quarantine.entries || [], function(_, entry) {
      var entryId = String(entry.id || "");

      if (entryId && entry.restoreStatus !== "missing") {
        state.quarantine.selected[entryId] = true;
      }
    });

    syncQuarantineManagerSelectionUi();
  }

  function buildQuarantineSelectionSummaryText(selectedCount) {
    return ACP.plural("{count} folders selected", selectedCount);
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
    $modal.find("[data-entry-action]").each(function() {
      var $button = $(this);
      var entry = findQuarantineEntries([String($button.data("entry-id") || "")])[0] || {};
      $button.prop("disabled", state.busy || state.quarantine.loading || entry.restoreStatus === "missing" || ($button.data("entry-action") === "restore" && entry.restoreStatus === "blocked"));
    });
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

    apiPostForUserAction({
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

    facts.push('<span class="acp-row-meta-item"><strong>' + ACP.escapeHtml(ACP.t(strings, "sizeLabel", "Size")) + "</strong> " + ACP.escapeHtml(row.statsPending ? ACP.t(strings, "sizeLoadingLabel", "Loading...") : (row.sizeLabel || ACP.tr("Unknown"))) + "</span>");
    facts.push(
      '<span class="acp-row-meta-item"' + (row.lastModifiedExact ? ' title="' + ACP.escapeHtml(row.lastModifiedExact) + '"' : "") + '><strong>' +
      ACP.escapeHtml(ACP.t(strings, "updatedLabel", "Updated")) +
      "</strong> " + ACP.escapeHtml(row.lastModifiedLabel || ACP.tr("Unknown")) + "</span>"
    );

    return facts.join('<span class="acp-row-meta-separator">|</span>');
  }

  function buildRowNotesHtml(row) {
    var notes = [];
    var actionability = getRowActionabilityDescriptor(row).value;
    var explanation = ACP.buildRowReviewExplanation
      ? ACP.buildRowReviewExplanation({ state: state, strings: strings }, row)
      : null;

    if (row.reason) {
      notes.push('<div class="acp-row-note is-primary">' + ACP.escapeHtml(row.reason) + "</div>");
    }

    if ((actionability === "review" || actionability === "locked") && explanation) {
      if (explanation.why) {
        notes.push(
          '<div class="acp-row-note is-warning"><span class="acp-row-note-label">' +
          ACP.escapeHtml(ACP.t(strings, "rowDetailsWhyLabel", "Why")) +
          ':</span> ' + ACP.escapeHtml(explanation.why) + "</div>"
        );
      }

      if (explanation.how) {
        notes.push(
          '<div class="acp-row-note"><span class="acp-row-note-label">' +
          ACP.escapeHtml(ACP.t(strings, "rowDetailsResolveLabel", "How to resolve")) +
          ':</span> ' + ACP.escapeHtml(explanation.how) + "</div>"
        );
      }
    } else if (row.policyReason) {
      notes.push('<div class="acp-row-note is-warning">' + ACP.escapeHtml(row.policyReason) + "</div>");
    }

    if (row.storageKind === "zfs" && row.zfsImpactSummary) {
      notes.push('<div class="acp-row-note">' + ACP.escapeHtml(row.zfsImpactSummary) + "</div>");
    } else if (row.storageKind === "zfs" && !row.policyReason) {
      notes.push('<div class="acp-row-note">' + ACP.escapeHtml(ACP.t(strings, "selectionHintZfsMode", "ZFS dataset-backed rows require permanent delete mode and cannot be quarantined.")) + "</div>");
    }

    if (row.zfsMappingMatched && row.storageKind !== "zfs" && row.zfsResolutionMessage) {
      notes.push('<div class="acp-row-note">' + ACP.escapeHtml(row.zfsResolutionMessage) + "</div>");
    }

    if (row.zfsPreviewError) {
      notes.push('<div class="acp-row-note is-warning">' + ACP.escapeHtml(row.zfsPreviewError) + "</div>");
    }

    if (row.ignored && row.ignoredReason) {
      notes.push('<div class="acp-row-note">' + ACP.escapeHtml(row.ignoredReason) + "</div>");
    } else if (!explanation && !row.policyReason && row.risk !== "safe" && row.riskReason) {
      notes.push('<div class="acp-row-note">' + ACP.escapeHtml(row.riskReason) + "</div>");
    }

    return notes.join("");
  }

  function buildRowActionHtml(row) {
    var actions = [];
    var actionability = getRowActionabilityDescriptor(row).value;

    if (row.id) {
      actions.push('<button type="button" class="acp-button acp-button-secondary acp-row-action" data-row-action="details" data-row-id="' + ACP.escapeHtml(row.id || "") + '">' + ACP.escapeHtml(ACP.t(strings, "rowDetailsActionLabel", "Details")) + "</button>");
    }

    if (row.ignored) {
      actions.push('<button type="button" class="acp-button acp-button-secondary acp-row-action" data-row-action="unignore" data-row-id="' + ACP.escapeHtml(row.id || "") + '">' + ACP.escapeHtml(ACP.t(strings, "restoreActionLabel", "Stop ignoring")) + "</button>");
      return '<div class="acp-row-actions">' + actions.join("") + "</div>";
    }

    if (actionability === "locked") {
      return '<div class="acp-row-actions">' + actions.join("") + "</div>";
    }

    if (row.id) {
      actions.push('<button type="button" class="acp-button acp-button-secondary acp-row-action" data-row-action="ignore" data-row-id="' + ACP.escapeHtml(row.id || "") + '">' + ACP.escapeHtml(ACP.t(strings, "ignoreActionLabel", "Ignore")) + "</button>");
      return '<div class="acp-row-actions">' + actions.join("") + "</div>";
    }

    return "";
  }

  function revealSelectedRow(rowId) {
    window.clearTimeout(selectedRowFeedback.timer);
    selectedRowFeedback.rowId = "";
    selectedRowFeedback.expiresAt = 0;
    els.$results.find(".acp-row.is-selection-highlight").removeClass("is-selection-highlight");
    // Wait for the native close animation before restoring page focus/scroll.
    selectedRowFeedback.timer = window.setTimeout(function() {
      selectedRowFeedback.timer = null;
      ACP.releaseModalScrollLock(false);
      if (getActiveSweetAlertModal().length) return;
      var $row = els.$results.find(".acp-row").filter(function() {
        return this.getAttribute("data-row-id") === rowId;
      }).first();
      if (!$row.length || !state.selected[rowId]) return;

      selectedRowFeedback.rowId = rowId;
      selectedRowFeedback.expiresAt = Date.now() + 3000;
      $row.addClass("is-selection-highlight");
      $row[0].scrollIntoView({behavior: "instant", block: "start", inline: "nearest"});
      var checkbox = $row.find(".acp-row-checkbox")[0];
      if (checkbox) checkbox.focus({preventScroll: true});
      selectedRowFeedback.timer = window.setTimeout(function() {
        selectedRowFeedback.rowId = "";
        selectedRowFeedback.expiresAt = 0;
        selectedRowFeedback.timer = null;
        els.$results.find(".acp-row.is-selection-highlight").removeClass("is-selection-highlight");
      }, 3000);
    }, 180);
  }

  function buildResultsSectionDefinitions() {
    return [
      {
        key: "ready",
        title: ACP.t(strings, "readySectionTitle", "Ready to clean"),
        message: ACP.t(strings, "readySectionMessage", "Current checks allow cleanup of these folders. Confirm that you no longer need them, then use Dry run. Quarantine is recommended for folders.")
      },
      {
        key: "zfs",
        title: ACP.t(strings, "zfsSectionTitle", "ZFS datasets"),
        message: ACP.t(strings, "zfsSectionMessage", "These are exact ZFS dataset-backed appdata rows. They use dataset destroy instead of folder quarantine.")
      },
      {
        key: "locked",
        title: ACP.t(strings, "protectedSectionTitle", "Blocked"),
        message: ACP.t(strings, "protectedSectionMessage", "Cleanup is unavailable for these items. Open Details to see the reason and what to check next.")
      },
      {
        key: "ignored",
        title: ACP.t(strings, "ignoredSectionTitle", "Ignored"),
        message: ACP.t(strings, "ignoredSectionMessage", "Hidden by your ignore list. Stop ignoring includes them in scan results again without moving or restoring files.")
      }
    ];
  }

  function getResultsSectionKey(row) {
    if (row.ignored) {
      return "ignored";
    }

    if (row.storageKind === "zfs") {
      return "zfs";
    }

    return getRowActionabilityDescriptor(row).value;
  }

  function sanitizeBadgeToken(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  }

  function buildBadgeHtml(badge) {
    var classes = ["acp-badge", "acp-badge-tone-" + sanitizeBadgeToken(badge.tone || "neutral")];
    var kindClass = badge.kindClass || badge.kind || "";
    var title = $.trim(String(badge.title || ""));

    if (kindClass) {
      classes.push("acp-badge-kind-" + sanitizeBadgeToken(kindClass));
    }

    if (badge.isPrimary) {
      classes.push("is-primary");
    }

    return '<span class="' + classes.join(" ") + '"' + (title ? ' title="' + ACP.escapeHtml(title) + '"' : "") + ">" + ACP.escapeHtml(String(badge.label || "")) + "</span>";
  }

  function getActionabilityLabel(actionability) {
    if (actionability === "ignored") {
      return ACP.t(strings, "ignoredSectionTitle", "Ignored");
    }

    if (actionability === "locked") {
      return ACP.t(strings, "cardBlocked", "Blocked");
    }

    return ACP.t(strings, "cardDeletable", "Ready");
  }

  function getRowActionabilityDescriptor(row) {
    var explanation = ACP.buildRowReviewExplanation(buildContext(), row);

    if (row.ignored) {
      return {
        kind: "actionability",
        value: "ignored",
        label: ACP.t(strings, "ignoredSectionTitle", "Ignored"),
        tone: "neutral",
        title: row.ignoredReason || "",
        kindClass: "actionability",
        isPrimary: true
      };
    }

    if (explanation.state === "protected") {
      return {
        kind: "actionability",
        value: "locked",
        label: explanation.label,
        tone: "locked",
        title: row.policyReason || row.securityLockReason || row.riskReason || "",
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
      label: row.statusLabel || ACP.tr("Orphaned"),
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
      tone: row.sourceKind === "filesystem" ? "discovery" : "template",
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
      tone: "zfs",
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
      if (row.securityReasonCode === "symlink") {
        pushBadgeDescriptor(descriptors, {
          kind: "reason",
          value: "symlink",
          label: ACP.t(strings, "badgeReasonSymlink", "Symlink"),
          tone: "locked",
          title: securityReason,
          kindClass: "reason"
        });
      } else if (row.securityReasonCode === "mount_point") {
        pushBadgeDescriptor(descriptors, {
          kind: "reason",
          value: "mount_point",
          label: ACP.t(strings, "badgeReasonMountPoint", "Mount point"),
          tone: "locked",
          title: securityReason,
          kindClass: "reason"
        });
      } else if (row.securityReasonCode === "root_path") {
        pushBadgeDescriptor(descriptors, {
          kind: "reason",
          value: "root_path",
          label: ACP.t(strings, "badgeReasonRootPath", "Root path"),
          tone: "locked",
          title: securityReason,
          kindClass: "reason"
        });
      } else if (row.securityReasonCode === "unsafe_path") {
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

    if (row.sourceKind === "template" && policyReason) {
      pushBadgeDescriptor(descriptors, {
        kind: "reason",
        value: "template_reference",
        label: ACP.t(strings, "badgeReasonTemplateReference", "Template reference"),
        tone: "review",
        title: policyReason,
        kindClass: "reason"
      });
    }

    if (row.storageKind === "zfs" && row.policyReasonCode === "permanent_delete") {
      pushBadgeDescriptor(descriptors, {
        kind: "reason",
        value: "delete_mode_off",
        label: ACP.t(strings, "badgeReasonDeleteModeOff", "Delete mode off"),
        tone: "locked",
        title: policyReason,
        kindClass: "reason"
      });
    }

    if (row.zfsMappingMatched && row.storageKind !== "zfs") {
      pushBadgeDescriptor(descriptors, {
        kind: "reason",
        value: "no_exact_dataset",
        label: ACP.t(strings, "badgeReasonNoExactDataset", "No exact dataset"),
        tone: "review",
        title: row.zfsResolutionMessage || row.zfsResolutionDetail || "",
        kindClass: "reason"
      });
    }

    if (
      row.policyLocked &&
      !securityReason &&
      row.policyReasonCode !== "zfs_disabled" &&
      row.policyReasonCode !== "permanent_delete"
    ) {
      pushBadgeDescriptor(descriptors, {
        kind: "reason",
        value: "policy_lock",
        label: ACP.t(strings, "badgeReasonPolicyLock", "Policy lock"),
        tone: "locked",
        title: policyReason || riskReason,
        kindClass: "reason"
      });
    }

    return descriptors;
  }

  function getRowBadgeDescriptors(row) {
    var descriptors = [getRowSourceDescriptor(row)];
    pushBadgeDescriptor(descriptors, getRowStorageDescriptor(row));
    return descriptors;
  }

  function buildSectionActionabilitySummary(rows) {
    var summary = { ready: 0, review: 0, locked: 0, ignored: 0 };

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
      label: ACP.plural("{count} folders are visible.", (rows || []).length),
      tone: "neutral",
      kindClass: "count"
    }));

    $.each(["locked", "review", "ready", "ignored"], function(_, actionability) {
      var count = Number(summary[actionability] || 0);

      if (!count) {
        return;
      }

      badges.push(buildBadgeHtml({
        kind: "actionability",
        value: actionability,
        label: actionability === "locked" ? ACP.plural("{count} items blocked", count)
          : (actionability === "ignored" ? ACP.plural("{count} items ignored", count) : ACP.plural("{count} items ready", count)),
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
    var badgeHtml = $.map(getRowBadgeDescriptors(row), function(badge) {
      return buildBadgeHtml(badge);
    }).join("");
    var sourceText = row.sourceDisplay || row.sourceSummary || row.name || "";
    var targetText = row.targetSummary || "";
    var explanation = ACP.buildRowReviewExplanation(buildContext(), row);
    var nextStepHtml = !row.ignored && explanation.state === "protected"
      ? '<div class="acp-row-next-step"><strong>' + ACP.escapeHtml(ACP.tr("What to check next")) + ':</strong> ' + ACP.escapeHtml(explanation.how) + '</div>'
      : "";

    if (isSelected) {
      rowClass += " is-selected";
    }
    if (isSelected && row.id === selectedRowFeedback.rowId && Date.now() < selectedRowFeedback.expiresAt) {
      rowClass += " is-selection-highlight";
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
          '<input type="checkbox" class="acp-row-checkbox" data-row-id="' + ACP.escapeHtml(row.id) + '" aria-label="' + ACP.escapeHtml(row.displayPath || row.path || row.name || ACP.tr("Unknown folder")) + '"' + (isSelected ? " checked" : "") + (selectable ? "" : " disabled") + ">" +
        "</div>" +
        '<div class="acp-row-main">' +
          '<div class="acp-row-primary">' +
            '<div class="acp-row-title-wrap">' +
              '<div class="acp-row-title-line">' +
                ACP.buildRowFolderIconHtml(row) +
                '<h3 class="acp-row-title">' + ACP.escapeHtml(row.name || row.displayPath || "") + "</h3>" +
              "</div>" +
              '<div class="acp-row-meta">' +
                '<span class="acp-row-meta-item">' + ACP.escapeHtml(sourceText) + "</span>" +
                (targetText ? '<span class="acp-row-meta-separator">•</span><span class="acp-row-meta-item">' + ACP.escapeHtml(targetText) + "</span>" : "") +
              "</div>" +
            "</div>" +
            '<div class="acp-row-used">' +
              '<span>' + ACP.escapeHtml(row.lastModifiedLabel || ACP.tr("Unknown")) + "</span>" +
              '<small>' + ACP.escapeHtml(ACP.t(strings, "updatedLabel", "Updated")) + "</small>" +
            "</div>" +
            '<div class="acp-row-size">' + ACP.escapeHtml(row.statsPending ? ACP.t(strings, "sizeLoadingLabel", "Loading...") : (row.sizeLabel || ACP.tr("Unknown"))) + "</div>" +
            '<code class="acp-row-path">' + ACP.escapeHtml(row.displayPath || "") + "</code>" +
            '<div class="acp-row-badges">' + badgeHtml + ACP.buildMountEvidenceHtml(row.mountEvidence) + "</div>" +
            '<div class="acp-row-detection-reason"><span class="acp-row-detection-label">' + ACP.escapeHtml(ACP.tr("Detection reason")) + '</span>' + ACP.escapeHtml(explanation.blockType ? explanation.why : ACP.getRowDetectionReason(row)) + nextStepHtml + "</div>" +
            '<div class="acp-row-side">' +
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
        state.scanVerification === "incomplete" ? ACP.tr("Ownership check incomplete") : (hasPartialDiscovery() ? ACP.tr("Scan incomplete") : ACP.t(strings, "emptyTitle", "No orphaned appdata found")),
        state.scanVerification === "incomplete" ? state.scanWarningMessage : (buildEmptyStateMessage() || ACP.t(strings, "emptyMessage", "Nothing currently looks safe to clean up from the configured appdata sources or saved Docker templates.")),
        "rescan",
        ACP.t(strings, "rescanLabel", "Rescan")
      );
      return;
    }

    if (!visibleRows.length) {
      if (Number(state.summary.total || 0) === 0 && Number(state.summary.ignored || 0) > 0) {
        renderStateMessage(
          ACP.t(strings, "ignoredOnlyTitle", "Only ignored paths remain"),
          ACP.t(strings, "ignoredOnlyMessage", "Every detected item is hidden by your ignore list. Choose Show ignored to review them, then Stop ignoring to include an item again."),
          null,
          null
        );
        return;
      }

      renderStateMessage(
        ACP.t(strings, "noMatchesTitle", "No folders match the current search"),
        ACP.t(strings, "noMatchesMessage", "Clear the search field to see the full scan again."),
        null,
        null
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
          '<div class="acp-results-table-head">' +
            '<span></span><span>' + ACP.escapeHtml(ACP.t(strings, "nameLabel", "Name")) + '</span><span>' + ACP.escapeHtml(ACP.tr("Last modified")) + '</span><span>' + ACP.escapeHtml(ACP.t(strings, "sizeLabel", "Size")) + '</span><span>' + ACP.escapeHtml(ACP.t(strings, "pathLabel", "Path")) + '</span><span>' + ACP.escapeHtml(ACP.t(strings, "sourceLabel", "Source")) + '</span><span>' + ACP.escapeHtml(ACP.tr("Detection reason")) + '</span><span>' + ACP.escapeHtml(ACP.t(strings, "actionsLabel", "Actions")) + '</span>' +
          "</div>" +
          '<div class="acp-results-section-body">' + rowHtml.join("") + "</div>" +
        "</section>"
      );
    });

    els.$results.html(html.join(""));
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

      if (row.ignored) {
        return !!state.showIgnored;
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
    var leftSource = String(left.sourceDisplay || left.sourceSummary || "").toLowerCase();
    var rightSource = String(right.sourceDisplay || right.sourceSummary || "").toLowerCase();
    var leftType = String(left.storageKind === "zfs" ? "zfs dataset" : (left.sourceType || left.sourceLabel || "")).toLowerCase();
    var rightType = String(right.storageKind === "zfs" ? "zfs dataset" : (right.sourceType || right.sourceLabel || "")).toLowerCase();
    var leftSize = left.sizeBytes === null || left.sizeBytes === undefined ? -1 : Number(left.sizeBytes || 0);
    var rightSize = right.sizeBytes === null || right.sizeBytes === undefined ? -1 : Number(right.sizeBytes || 0);
    var leftModified = Number(left.lastModified || 0);
    var rightModified = Number(right.lastModified || 0);
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

    if (state.sortMode === "last-used") {
      return rightModified - leftModified || leftName.localeCompare(rightName) || leftPath.localeCompare(rightPath);
    }

    if (state.sortMode === "size") {
      return rightSize - leftSize || leftName.localeCompare(rightName) || leftPath.localeCompare(rightPath);
    }

    if (state.sortMode === "source") {
      return leftSource.localeCompare(rightSource) || leftName.localeCompare(rightName) || leftPath.localeCompare(rightPath);
    }

    if (state.sortMode === "type") {
      return leftType.localeCompare(rightType) || leftName.localeCompare(rightName) || leftPath.localeCompare(rightPath);
    }

    return leftRank - rightRank || leftPath.localeCompare(rightPath);
  }

  function selectVisibleRows() {
    $.each(getVisibleRows(), function(_, row) {
      if (isReadySelectableRow(row)) {
        state.selected[row.id] = true;
      }
    });

    renderResults();
    renderSummaryCards();
    updateActionBar();
  }

  function selectAllRows() {
    $.each(state.rows || [], function(_, row) {
      if (isReadySelectableRow(row)) {
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
    var selectedReadyRows = $.grep(selectedRows, function(row) {
      return isReadySelectableRow(row);
    });
    var totalSelectableCount = $.grep(state.rows || [], function(row) {
      return isReadySelectableRow(row);
    }).length;
    var visibleSelectableCount = $.grep(getVisibleRows(), function(row) {
      return isReadySelectableRow(row);
    }).length;
    var summaryText = ACP.plural("{count} folders selected", selectedRows.length);
    var totalText = ACP.plural("{count} items total", state.summary.total || 0);
    var detailText = ACP.t(strings, "selectionHintIdle", "Select ready rows to clean them. Protected paths stay blocked.");

    if (!state.scanToken && Number(state.summary.total || 0) > 0) {
      detailText = ACP.t(strings, "selectionHintReadOnly", "Scan results are read-only right now because the secure action snapshot could not be created.");
    } else if (selectedActionRows.length && state.settings.enablePermanentDelete) {
      detailText = ACP.t(strings, "selectionHintDeleteMode", "Permanent delete requires confirmation with a checkbox.");
    } else if (selectedActionRows.length) {
      detailText = ACP.t(strings, "selectionHintQuarantineMode", "Selected folders will be moved into quarantine instead of being permanently deleted.");
    }

    els.$selectionSummary.text(summaryText);
    els.$selectionDetail.text(totalText + " · " + detailText);
    if (els.$actionToolbar && els.$actionToolbar.length) {
      els.$actionToolbar.find(".acp-action-toolbar-copy span").text(selectedRows.length ? summaryText : ACP.t(strings, "noItemsSelectedLabel", "No items selected"));
    }
    els.$primaryAction.find(".acp-button-label").text(getPrimaryActionLabel());
    els.$primaryAction.toggleClass("acp-button-danger", !!state.settings.enablePermanentDelete);
    els.$primaryAction.prop("disabled", state.busy || !state.scanToken || selectedActionRows.length === 0);
    els.$dryRun.prop("disabled", state.busy || !state.scanToken || selectedActionRows.length === 0);
    els.$selectAll.prop("disabled", state.busy || totalSelectableCount === 0 || selectedReadyRows.length >= totalSelectableCount);
    els.$selectVisible.prop("disabled", state.busy || visibleSelectableCount === 0);
    els.$clearSelection.prop("disabled", state.busy || selectedRows.length === 0);
    if (els.$bottomBar && els.$bottomBar.length) {
      els.$bottomBar.toggleClass("is-empty", !(state.rows || []).length);
    }
    syncActionBarLayout();
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

  function saveSafetySettings(overrides, options) {
    var normalizedOverrides = $.isPlainObject(overrides) ? overrides : {};
    var normalizedOptions = $.isPlainObject(options) ? options : {};
    var previousSettings = $.extend({}, ACP.defaultSafetySettings(), state.settings || {});
    var previousRows = state.rows.slice(0);
    var previousSummary = $.extend({}, state.summary || {});
    var previousAppdataSources = $.extend(true, { detected: [], manual: [], effective: [], zfsPathMappings: [] }, state.appdataSources || {});
    var wasQuarantineManagerVisible = isQuarantineManagerModalVisible();
    var nextSettings = $.extend({}, previousSettings, {
      enableZfsDatasetDelete: true
    }, normalizedOverrides);
    nextSettings.enableZfsDatasetDelete = true;
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
      enablePermanentDelete: nextSettings.enablePermanentDelete ? "1" : "0",
      enableZfsDatasetDelete: "1",
      quarantineRoot: nextSettings.quarantineRoot || previousSettings.quarantineRoot || "",
      defaultQuarantinePurgeDays: String(Number(nextSettings.defaultQuarantinePurgeDays || 0)),
      manualAppdataSources: ($.isArray(nextSettings.manualAppdataSources) ? nextSettings.manualAppdataSources : []).join("\n"),
      zfsPathMappings: JSON.stringify($.isArray(nextSettings.zfsPathMappings) ? nextSettings.zfsPathMappings : [])
    };

    if (state.scanToken) {
      requestData.scanToken = state.scanToken;
    }

    apiPostForUserAction(requestData).done(function(response) {
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
      if (isZfsPathMappingsModalVisible()) {
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
        nextRow.ignoredReason = ACP.tr("Use Stop ignoring to include this folder in scan results again. This does not move or restore files.");
        nextRow.status = "ignored";
        nextRow.statusLabel = ACP.tr("Ignored");
      } else if (intent === "unignore") {
        nextRow.ignored = false;
        nextRow.ignoredAt = "";
        nextRow.ignoredAtLabel = "";
        nextRow.ignoredReason = "";
        nextRow.status = nextRow.scanVerificationLocked ? "unverified" : (state.dockerRunning ? "orphaned" : "docker_offline");
        nextRow.statusLabel = nextRow.scanVerificationLocked ? ACP.tr("Unverified") : (state.dockerRunning ? ACP.tr("Orphaned") : ACP.tr("Docker offline"));
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
    var intent = action === "unignore" ? "unignore" : (action === "unlock" || action === "relock" ? action : "ignore");

    postCandidateStateIntent([rowId], intent, {
      failureTitle: action === "unignore"
        ? ACP.t(strings, "restoreFailedTitle", "Ignore list update failed")
        : ACP.t(strings, "ignoreFailedTitle", "Ignore failed"),
      failureMessage: action === "unignore"
        ? ACP.t(strings, "restoreFailedMessage", "The ignore list could not be updated right now.")
        : ACP.t(strings, "ignoreFailedMessage", "The ignore list could not be updated right now.")
    });
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
      deleteTargetLabelPlural: deleteTargetLabelPlural,
      targetKind: zfsCount > 0 ? (folderCount > 0 ? "items" : "datasets") : "folders"
    };
  }

  function buildActionConfirmButtonText(context, count) {
    if (context.baseOperation === "quarantine") return ACP.plural("Quarantine {count} folders", count);
    if (context.targetKind === "datasets") return ACP.plural("Destroy {count} datasets", count);
    if (context.targetKind === "items") return ACP.plural("Delete {count} items", count);
    return ACP.plural("Delete {count} folders", count);
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
      suffix = " (+" + ACP.plural("{count} more", totalCount - previewCount) + ")";
    }

    return previewValues.join(", ") + suffix;
  }

  function getDeleteConfirmationTitle(context) {
    if (context.targetKind === "datasets") {
      return ACP.t(strings, "destroyCheckboxTitle", "Confirm dataset destroy");
    }

    if (context.targetKind === "items") {
      return ACP.t(strings, "deleteMixedCheckboxTitle", "Confirm delete");
    }

    return ACP.t(strings, "deleteCheckboxTitle", "Confirm permanent delete");
  }

  function syncDeleteConfirmationState() {
    var $modal = getActiveSweetAlertModal();
    var checked = !!$modal.find(".acp-delete-confirm-checkbox").prop("checked");

    $modal.find(".acp-delete-confirm-error").hide();
    $modal.find("button.confirm")
      .toggleClass("acp-confirm-disabled", !checked)
      .attr("aria-disabled", checked ? "false" : "true");
  }

  function requireDeleteConfirmationChecked() {
    var $modal = getActiveSweetAlertModal();
    var checked = !!$modal.find(".acp-delete-confirm-checkbox").prop("checked");

    if (!checked) {
      $modal.find(".acp-delete-confirm-error").show();
      $modal.find(".acp-delete-confirm-checkbox").focus();
      return false;
    }

    return true;
  }

  function buildDeleteConfirmationHtml(label) {
    return (
      '<label class="acp-delete-confirm-box">' +
        '<input type="checkbox" class="acp-delete-confirm-checkbox">' +
        '<span>' + ACP.escapeHtml(label) + "</span>" +
      "</label>" +
      '<div class="acp-delete-confirm-error" style="display:none;">' + ACP.escapeHtml(ACP.t(strings, "deleteCheckboxError", "Confirm the permanent delete before continuing.")) + "</div>"
    );
  }

  function buildOperationPreviewHtml(rows, context, options) {
    var settings = options || {};
    var safeCount = rows.length;
    var preview = rows.slice(0, 6);
    var selectedLabel = ACP.plural("{count} folders selected", rows.length);
    var actionLabel = context.baseOperation === "delete"
      ? ACP.t(strings, "deleteImmediateLabel", "Permanent delete")
      : ACP.t(strings, "quarantineActionLabel", "Quarantine");
    var icon = context.baseOperation === "delete" ? "!" : "Q";
    var html = [
      '<div class="acp-delete-simple-shell">',
      '<div class="acp-delete-simple-intro">',
      '<div class="acp-delete-simple-icon" aria-hidden="true">' + ACP.escapeHtml(icon) + "</div>",
      '<div class="acp-delete-simple-copy">',
      '<div class="acp-delete-simple-title">' + ACP.escapeHtml(actionLabel) + "</div>",
      '<div class="acp-delete-simple-message">' + ACP.escapeHtml(context.confirmMessage) + " " + ACP.escapeHtml(context.detailMessage) + "</div>",
      "</div>",
      '<div class="acp-delete-simple-pills">',
      '<span class="acp-modal-stat is-selected">' + ACP.escapeHtml(selectedLabel) + "</span>",
      '<span class="acp-modal-stat is-safe">' + ACP.escapeHtml(ACP.t(strings, "deleteSafeLabel", "Ready")) + ": " + ACP.escapeHtml(ACP.formatCount(safeCount)) + "</span>",
      "</div>",
      "</div>",
      '<section class="acp-delete-simple-card">',
      '<div class="acp-delete-simple-card-title">' + ACP.escapeHtml(context.listTitle) + "</div>",
      '<ul class="acp-delete-simple-list">'
    ];

    $.each(preview, function(_, row) {
      var details = [];

      html.push('<li class="acp-delete-simple-list-item">');
      html.push('<code class="acp-modal-path">' + ACP.escapeHtml(row.displayPath || row.path || "") + "</code>");

      if (row.datasetName) {
        details.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "zfsDatasetLabel", "ZFS dataset")) + '</span><code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(row.datasetName) + "</code></div>");
      }
      if (row.zfsImpactSummary) {
        details.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "zfsDestroyImpactLabel", "Impact")) + '</span><span class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(row.zfsImpactSummary) + "</span></div>");
      }
      if ($.isArray(row.zfsChildDatasets) && row.zfsChildDatasets.length) {
        details.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "zfsChildDatasetsLabel", "Child datasets")) + '</span><code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(formatPreviewList(row.zfsChildDatasets, Number(row.zfsChildDatasetCount || row.zfsChildDatasets.length))) + "</code></div>");
      }
      if ($.isArray(row.zfsSnapshots) && row.zfsSnapshots.length) {
        details.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "zfsSnapshotsLabel", "Snapshots")) + '</span><code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(formatPreviewList(row.zfsSnapshots, Number(row.zfsSnapshotCount || row.zfsSnapshots.length))) + "</code></div>");
      }

      if (details.length) {
        html.push('<details class="acp-simple-disclosure acp-delete-simple-details"><summary>' + ACP.escapeHtml(ACP.t(strings, "rowDetailsTechnicalTitle", "Technical details")) + "</summary>" + details.join("") + "</details>");
      }
      html.push("</li>");
    });

    if (rows.length > preview.length) {
      html.push('<li class="acp-modal-list-more">' + ACP.escapeHtml(ACP.plural("{count} more", rows.length - preview.length)) + "</li>");
    }

    html.push("</ul></section>");
    html.push(buildActionOutcomeSummary(rows, context, false));

    if (settings.showConfirmationCheckbox) {
      var confirmationLabel = ACP.t(strings, "deleteCheckboxConfirmLabel", "I confirm I want to permanently delete the selected folders. This action cannot be undone by this plugin.");

      if (context.deleteTargetLabelPlural === ACP.t(strings, "deleteDatasetPlural", "datasets")) {
        confirmationLabel = ACP.t(strings, "destroyCheckboxConfirmLabel", "I confirm I want to permanently destroy the selected datasets. This action cannot be undone by this plugin.");
      } else if (context.deleteTargetLabelPlural === ACP.t(strings, "deleteItemPlural", "items")) {
        confirmationLabel = ACP.t(strings, "deleteMixedCheckboxConfirmLabel", "I confirm I want to permanently remove the selected items. This action cannot be undone by this plugin.");
      }

      html.push(buildDeleteConfirmationHtml(confirmationLabel));
    }

    html.push("</div>");
    return html.join("");
  }

  function resultGroup(result) {
    if (["quarantined", "deleted", "restored", "purged", "ready"].indexOf(result.status) !== -1) return "completed";
    return result.status === "error" ? "failed" : "skipped";
  }

  function orderedActionResults(results) {
    return (results || []).slice().sort(function(a, b) {
      return ["failed", "skipped", "completed"].indexOf(resultGroup(a)) - ["failed", "skipped", "completed"].indexOf(resultGroup(b));
    });
  }

  function resultNextStep(result) {
    if (result.status === "conflict") return ACP.tr("Resolve the destination conflict, then restore again.");
    if (result.status === "blocked") return ACP.tr("Review the reason above before retrying. Rescan for current ownership and safety checks; changing Safe Mode does not bypass protection.");
    if (result.status === "missing") return ACP.tr("Check that the storage is mounted and the folder still exists, then rescan or refresh. Do not recreate a folder just to retry cleanup.");
    if (result.status === "error") return ACP.tr("Review the error and check storage access, then retry. Safety checks run again before any changes.");
    if (result.status === "skipped") return ACP.tr("Review why this item was skipped before trying again.");
    return "";
  }

  function buildActionOutcomeSummary(items, context, fromResults) {
    var folders = 0, datasets = 0, skipped = 0;
    $.each(items || [], function(_, item) {
      if (fromResults && item.status !== "ready") { skipped++; return; }
      if (item.datasetName || item.storageKind === "zfs") datasets++; else folders++;
    });
    var counts = [
      [ACP.tr("Folders to quarantine"), context.baseOperation === "quarantine" ? folders : 0],
      [ACP.tr("Folders to permanently delete"), context.baseOperation === "delete" ? folders : 0],
      [ACP.tr("Selected datasets to destroy"), context.baseOperation === "delete" ? datasets : 0],
      [ACP.tr("Items that will not be changed"), skipped]
    ];
    return '<section class="acp-delete-simple-card acp-action-outcome-summary"><div class="acp-delete-simple-card-title">' + ACP.escapeHtml(ACP.tr("Expected outcome")) + '</div>' + counts.map(function(pair) {
      return '<div class="acp-modal-result-message">' + ACP.escapeHtml(pair[0]) + ': ' + ACP.escapeHtml(ACP.formatCount(pair[1])) + '</div>';
    }).join('') + '<p>' + ACP.escapeHtml(context.baseOperation === "quarantine" ? ACP.tr("Quarantine moves folders and normally does not free space. Space is released only when data is permanently purged.") : ACP.tr("Folder size is not a guarantee of reclaimed space. ZFS snapshots and shared blocks can affect how much space is released.")) + '</p>' + (datasets ? '<p>' + ACP.escapeHtml(ACP.tr("Dataset counts refer to selected roots. Review each dataset for affected children and snapshots.")) + '</p>' : '') + '</section>';
  }

  function buildOperationResultsHtml(summary, results, context) {
    var stats = [];
    var successfulCount = Number(summary.deleted || 0) + Number(summary.quarantined || 0) + Number(summary.ready || 0);
    var warningCount = Number(summary.skipped || 0) + Number(summary.blocked || 0) + Number(summary.missing || 0) + Number(summary.errors || 0);
    var leadMessage = context.preview
      ? ACP.t(strings, "operationPreviewLead", "Review what would happen before running the action.")
      : (warningCount > 0
        ? ACP.t(strings, "operationResultsWarningLead", "Some folders could not be cleaned. Review the items below and fix anything that is still in use.")
        : ACP.t(strings, "operationResultsSuccessLead", "The action completed successfully. Review the final status for each row below."));
    var icon = context.preview ? "P" : (warningCount > 0 ? "!" : "✓");
    var title = context.preview
      ? ACP.t(strings, "operationPreviewTitle", "Preview")
      : (warningCount > 0 ? context.resultTitleWarning : context.resultTitleSuccess);
    var html = [
      '<div class="acp-delete-simple-shell acp-delete-results-simple">',
      '<div class="acp-delete-simple-intro">',
      '<div class="acp-delete-simple-icon" aria-hidden="true">' + ACP.escapeHtml(icon) + "</div>",
      '<div class="acp-delete-simple-copy">',
      '<div class="acp-delete-simple-title">' + ACP.escapeHtml(title) + "</div>",
      '<div class="acp-delete-simple-message">' + ACP.escapeHtml(leadMessage) + "</div>",
      "</div>"
    ];

    function pushStat(count, label, tone, allowZero) {
      var numericCount = Number(count || 0);

      if (numericCount <= 0 && !allowZero) {
        return;
      }

      stats.push('<span class="acp-modal-stat ' + ACP.escapeHtml(tone || "") + '">' + ACP.escapeHtml(label) + ": " + ACP.escapeHtml(ACP.formatCount(numericCount)) + "</span>");
    }

    if (context.preview) {
      pushStat(summary.ready, ACP.t(strings, "previewReadyLabel", "Ready"), "is-selected", warningCount <= 0);
    } else if (context.baseOperation === "delete") {
      pushStat(summary.deleted, ACP.t(strings, "resultDeletedLabel", "Deleted"), "is-selected", warningCount <= 0);
    } else {
      pushStat(summary.quarantined, ACP.t(strings, "resultQuarantinedLabel", "Quarantined"), "is-safe", warningCount <= 0);
    }

    if (!context.preview && successfulCount > 0) {
      stats.push('<span class="acp-modal-stat is-safe">' + ACP.escapeHtml(ACP.t(strings, "operationResultsCompletedLabel", "Completed")) + ": " + ACP.escapeHtml(ACP.formatCount(successfulCount)) + "</span>");
    }
    pushStat(summary.skipped, ACP.t(strings, "resultSkippedLabel", "Skipped"), "is-review");
    pushStat(summary.blocked, ACP.t(strings, "resultBlockedLabel", "Blocked"), "is-blocked");
    pushStat(summary.missing, ACP.t(strings, "resultMissingLabel", "Missing"), "is-review");
    pushStat(summary.errors, ACP.t(strings, "resultErrorLabel", "Error"), "is-blocked");
    if (!stats.length) {
      pushStat(0, ACP.t(strings, "operationResultsCompletedLabel", "Completed"), "is-safe", true);
    }

    html.push('<div class="acp-delete-simple-pills">' + stats.join("") + "</div>");
    html.push("</div>");
    if (context.preview) html.push(buildActionOutcomeSummary(results, context, true));
    html.push('<section class="acp-delete-simple-card">');
    html.push('<div class="acp-delete-simple-card-title">' + ACP.escapeHtml(warningCount > 0 ? ACP.t(strings, "operationResultNeedsAttentionTitle", "Needs attention") : context.listTitle) + "</div>");
    html.push('<ul class="acp-delete-simple-list acp-delete-result-list">');

    var previousGroup = "";
    $.each(orderedActionResults(results), function(_, result) {
      var group = resultGroup(result);
      if (group !== previousGroup) {
        html.push('<li class="acp-delete-simple-card-title" data-result-group="' + group + '">' + ACP.escapeHtml(group === "failed" ? ACP.tr("Failed") : (group === "skipped" ? ACP.tr("Skipped or blocked") : (context.preview ? ACP.tr("Ready") : ACP.tr("Completed")))) + '</li>');
        previousGroup = group;
      }
      var statusMeta = ACP.formatOperationResultStatus(strings, result.status);
      var destinationHtml = "";
      var messageHtml = result.message ? '<div class="acp-modal-result-message">' + ACP.escapeHtml(result.message) + "</div>" : "";
      if (resultNextStep(result)) messageHtml += '<div class="acp-modal-result-message acp-result-next-step">' + ACP.escapeHtml(resultNextStep(result)) + '</div>';

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
        '<li class="acp-delete-simple-list-item">' +
          '<div class="acp-delete-result-head">' +
            '<span class="acp-modal-stat ' + statusMeta.tone + '">' + ACP.escapeHtml(statusMeta.label) + "</span>" +
            '<code class="acp-modal-path">' + ACP.escapeHtml(result.displayPath || result.path || "") + '</code>' +
          "</div>" +
          messageHtml +
          destinationHtml +
        "</li>"
      );
    });

    html.push("</ul></section></div>");
    return html.join("");
  }

  function createOperationProgressId() {
    return "op-" + String(Date.now()) + "-" + String(Math.random()).replace(/[^0-9]/g, "").slice(0, 10);
  }

  function loadRecentOperations() {
    apiPost({action: "getRecentOperations"}).done(function(response) {
      state.recovery.operations = $.isArray(response.operations) ? response.operations : [];
      var $notice = $("#acp-operation-reminders");
      if (!$notice.length) $notice = $('<section id="acp-operation-reminders" class="acp-notices" aria-label="' + ACP.escapeHtml(ACP.tr("Recent operations")) + '"></section>').insertBefore(els.$notices);
      var html = [];
      $.each(state.recovery.operations, function(_, operation) {
        var labels = {delete: ACP.tr("Permanent delete"), quarantine: ACP.tr("Quarantine"), restore: ACP.tr("Restore"), purge: ACP.tr("Purge")};
        var time = ACP.localizePresentation({timestamp: operation.startedAt, timestampLabel: ""}).timestampLabel;
        html.push('<div class="acp-modal-hint"><span>' + ACP.escapeHtml(ACP.tr("Recent operations")) + ': ' + ACP.escapeHtml(labels[operation.operation] || ACP.tr("Action")) + (time ? ' — ' + ACP.escapeHtml(time) : '') + ' — ' + ACP.escapeHtml(operation.message || "") + '</span> <button type="button" class="acp-button acp-button-secondary" data-action="review-recent-operation" data-operation-id="' + ACP.escapeHtml(operation.id) + '">' + ACP.escapeHtml(ACP.tr("Review operation")) + '</button></div>');
      });
      $notice.html(html.join(""));
    });
  }

  function openRecoveredOperation(id) {
    state.recovery.activeId = String(id || "");
    state.recovery.terminal = false;
    state.recovery.openedAt = Date.now();
    swal({title: ACP.tr("Recent operations"), text: ACP.tr("Checking operation status."), type: "info", html: true,
      showCancelButton: false, confirmButtonText: ACP.tr("Close"), closeOnConfirm: true}, function() {
      state.recovery.activeId = "";
      var terminal = state.recovery.terminal;
      window.setTimeout(function() { ACP.releaseModalScrollLock(false); loadRecentOperations(); if (terminal) loadScan(); }, 180);
    });
    ACP.applyDeleteModalClass("acp-delete-modal acp-delete-results-modal acp-operation-recovery-modal");
    loadRecoveredOperation(id);
  }

  function loadRecoveredOperation(id) {
    if (!id || state.recovery.activeId !== id || !getActiveSweetAlertModal().hasClass("acp-operation-recovery-modal")) return;
    if (state.recovery.pollTimer) window.clearTimeout(state.recovery.pollTimer);
    var requestToken = createOperationProgressId();
    state.recovery.requestToken = requestToken;
    function current() { return state.recovery.activeId === id && state.recovery.requestToken === requestToken && getActiveSweetAlertModal().hasClass("acp-operation-recovery-modal"); }
    apiPost({action: "getOperationProgress", operationProgressId: id}).done(function(response) {
      if (!current()) return;
      var progress = response.progress || {};
      var running = progress.status === "running" || (progress.status === "missing" && Date.now() - state.recovery.openedAt < 15000);
      if (progress.status === "missing" && !running) progress.message = ACP.tr("No operation record was found. Check audit history and rescan before deciding whether to retry.");
      state.recovery.terminal = !running;
      var results = $.isArray(progress.results) ? progress.results : [];
      var html = '<div class="acp-modal-summary"><p role="status">' + ACP.escapeHtml(progress.message || ACP.tr("Checking operation status.")) + '</p>';
      html += '<p>' + ACP.escapeHtml(ACP.plural("Processed {count} folders.", Number(progress.completedRoots || 0))) + '</p>';
      if (progress.currentPath) html += '<code class="acp-modal-path">' + ACP.escapeHtml(progress.currentPath) + '</code>';
      if (progress.status === "interrupted" || progress.resultsLimited) html += '<p>' + ACP.escapeHtml(ACP.tr("Recorded results may be incomplete. Check audit history and rescan before taking further action.")) + '</p>';
      if (!running && progress.status !== "missing") html += '<button type="button" class="acp-button acp-button-secondary" data-action="dismiss-operation" data-operation-id="' + ACP.escapeHtml(id) + '">' + ACP.escapeHtml(ACP.tr("Dismiss reminder")) + '</button>';
      html += '</div>';
      if (results.length) html += progress.operation === "restore" || progress.operation === "purge"
        ? buildQuarantineManagerResultsHtml(progress.operation, progress.summary || {}, results)
        : buildOperationResultsHtml(progress.summary || {}, results, buildOperationContext(progress.operation, []));
      ACP.applyDeleteModalClass("acp-delete-modal acp-delete-results-modal acp-operation-recovery-modal", html);
      if (running) state.recovery.pollTimer = window.setTimeout(function() { loadRecoveredOperation(id); }, 2000);
    }).fail(function() {
      if (!current()) return;
      ACP.applyDeleteModalClass("acp-delete-modal acp-delete-results-modal acp-operation-recovery-modal", '<p role="status">' + ACP.escapeHtml(ACP.tr("The connection was interrupted. Status will be checked again. Do not repeat the action.")) + '</p>');
      state.recovery.pollTimer = window.setTimeout(function() { loadRecoveredOperation(id); }, 3000);
    });
  }

  function getOperationProgressRatio(progress) {
    var totalItems = Number((progress && progress.totalItems) || 0);
    var processedItems = Number((progress && progress.processedItems) || 0);
    var totalRoots = Number((progress && progress.totalRoots) || 0);
    var completedRoots = Number((progress && progress.completedRoots) || 0);

    if (totalItems > 0) {
      return Math.max(0, Math.min(1, processedItems / totalItems));
    }

    if (totalRoots > 0) {
      return Math.max(0, Math.min(1, completedRoots / totalRoots));
    }

    return 0;
  }

  function buildOperationProgressHtml(progress, context, readyForResults) {
    var currentProgress = $.isPlainObject(progress) ? progress : {};
    var ratio = readyForResults ? 1 : getOperationProgressRatio(currentProgress);
    var percent = Math.round(ratio * 100);
    var completedRoots = Number(currentProgress.completedRoots || 0);
    var totalRoots = Number(currentProgress.totalRoots || currentProgress.requestedCount || 0);
    var progressBarClass = "acp-delete-progress-bar" + (readyForResults ? " is-complete" : " is-running");
    var message = readyForResults
      ? ACP.t(strings, "deleteProgressComplete", "Delete finished. Review the results before leaving this screen.")
      : (currentProgress.message || ACP.t(strings, "deleteProgressRunning", "Removing selected folders now."));
    var html = [
      '<div class="acp-delete-simple-shell acp-delete-progress-summary">',
      '<div class="acp-delete-simple-intro">',
      '<div class="acp-delete-simple-icon" aria-hidden="true">' + (readyForResults ? "✓" : "...") + "</div>",
      '<div class="acp-delete-simple-copy">',
      '<div class="acp-delete-simple-title">' + ACP.escapeHtml(readyForResults ? ACP.t(strings, "deleteProgressCompleteTitle", "Delete complete") : context.loadingTitle) + "</div>",
      '<div class="acp-delete-simple-message">' + ACP.escapeHtml(message) + "</div>",
      "</div>",
      "</div>",
      '<section class="acp-delete-simple-card">',
      '<div class="' + progressBarClass + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + ACP.escapeHtml(String(percent)) + '">',
      '<span style="width:' + ACP.escapeHtml(String(percent)) + '%"></span>',
      "</div>",
      '<div class="acp-modal-stats">',
      '<span class="acp-modal-stat is-selected">' + ACP.escapeHtml(String(percent)) + "%</span>",
      '<span class="acp-modal-stat is-safe">' + ACP.escapeHtml(ACP.plural("Processed {count} folders.", completedRoots)) + (totalRoots > 0 ? (" " + ACP.escapeHtml(ACP.plural("{count} items total", totalRoots))) : "") + "</span>",
      "</div>"
    ];

    if (currentProgress.currentPath) {
      html.push(
        '<div class="acp-modal-result-destination">' +
          '<span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "deleteProgressCurrentLabel", "Current")) + "</span>" +
          '<code class="acp-modal-path">' + ACP.escapeHtml(currentProgress.currentPath) + "</code>" +
        "</div>"
      );
    }

    html.push("</section>");

    if (readyForResults) {
      html.push(
        '<div class="acp-delete-simple-actions">' +
          '<button type="button" class="acp-button acp-button-primary" data-action="view-operation-results">' + ACP.escapeHtml(ACP.t(strings, "deleteProgressViewResults", "View results")) + "</button>" +
        "</div>"
      );
    }

    html.push("</div>");
    return html.join("");
  }

  function syncOperationProgressModalButtons(readyForResults) {
    var $modal = getActiveSweetAlertModal();
    var $confirm = $modal.find("button.confirm");
    var $cancel = $modal.find("button.cancel");

    $cancel.hide();
    $confirm
      .toggleClass("acp-confirm-disabled", !readyForResults)
      .prop("disabled", !readyForResults)
      .attr("aria-disabled", readyForResults ? "false" : "true");
  }

  function renderOperationProgressModal(progress, context, readyForResults) {
    ACP.applyDeleteModalClass(
      "acp-delete-modal acp-delete-results-modal " + (readyForResults ? "acp-delete-progress-ready" : "acp-delete-progress-running"),
      buildOperationProgressHtml(progress, context, readyForResults)
    );
    syncOperationProgressModalButtons(!!readyForResults);
  }

  function stopOperationProgressPolling() {
    if (state.operationProgress.pollTimer) {
      window.clearTimeout(state.operationProgress.pollTimer);
      state.operationProgress.pollTimer = null;
    }
  }

  function pollOperationProgress(operationProgressId, context) {
    function current() {
      return state.operationProgress.activeId === operationProgressId && !state.operationProgress.pendingResult && getActiveSweetAlertModal().hasClass("acp-delete-progress-running");
    }

    if (!operationProgressId || !current()) {
      return;
    }

    apiPost({
      action: "getOperationProgress",
      operationProgressId: operationProgressId
    }).done(function(response) {
      if (!current()) return;
      var progress = $.isPlainObject(response && response.progress) ? response.progress : {};
      var readyForResults = !!state.operationProgress.pendingResult;

      state.operationProgress.latest = progress;
      renderOperationProgressModal(progress, context, readyForResults);

      if (!readyForResults) {
        state.operationProgress.pollTimer = window.setTimeout(function() {
          pollOperationProgress(operationProgressId, context);
        }, 500);
      }
    }).fail(function() {
      if (current()) {
        state.operationProgress.pollTimer = window.setTimeout(function() {
          pollOperationProgress(operationProgressId, context);
        }, 1000);
      }
    });
  }

  function startOperationProgressModal(operationProgressId, context) {
    state.operationProgress.activeId = operationProgressId;
    state.operationProgress.pendingResult = null;
    state.operationProgress.latest = {
      id: operationProgressId,
      status: "running",
      message: ACP.t(strings, "deleteProgressPreparing", "Preparing delete progress."),
      requestedCount: context.rows ? context.rows.length : 0,
      totalRoots: context.rows ? context.rows.length : 0,
      completedRoots: 0,
      totalItems: 0,
      processedItems: 0,
      recent: []
    };

    stopOperationProgressPolling();
    swal({
      title: ACP.t(strings, "deleteProgressTitle", "Deleting files"),
      text: "",
      type: "info",
      html: true,
      showConfirmButton: true,
      showCancelButton: false,
      closeOnConfirm: false,
      confirmButtonText: ACP.t(strings, "okLabel", "OK"),
      allowEscapeKey: false,
      allowOutsideClick: false
    }, function() {
      if (state.operationProgress.pendingResult) {
        showPendingOperationResults();
      }
      return false;
    });
    renderOperationProgressModal(state.operationProgress.latest, context, false);
    state.operationProgress.pollTimer = window.setTimeout(function() {
      pollOperationProgress(operationProgressId, context);
    }, 350);
  }

  function finalizeOperationProgressModal(response, context) {
    var latest = state.operationProgress.latest || {};
    var operationProgressId = state.operationProgress.activeId;

    stopOperationProgressPolling();
    state.operationProgress.pendingResult = {
      response: response,
      context: context
    };
    latest.status = response && response.ok === false ? "warning" : "complete";
    latest.message = ACP.t(strings, "deleteProgressComplete", "Delete finished. Review the results before leaving this screen.");
    latest.summary = response ? response.summary : null;
    state.operationProgress.latest = latest;
    renderOperationProgressModal(latest, context, true);

    if (operationProgressId) {
      apiPost({
        action: "getOperationProgress",
        operationProgressId: operationProgressId
      }).done(function(progressResponse) {
        var progress = $.isPlainObject(progressResponse && progressResponse.progress) ? progressResponse.progress : null;

        if (!progress || !state.operationProgress.pendingResult || state.operationProgress.activeId !== operationProgressId) {
          return;
        }

        state.operationProgress.latest = progress;
        renderOperationProgressModal(progress, context, true);
      });
    }
  }

  function showPendingOperationResults() {
    var pending = state.operationProgress.pendingResult;

    if (!pending) {
      return;
    }

    state.operationProgress.activeId = "";
    state.operationProgress.pendingResult = null;
    state.operationProgress.latest = null;
    stopOperationProgressPolling();
    showOperationResultsFromResponse(pending.response, pending.context);
  }

  function showOperationResultsFromResponse(response, context) {
    var summary = response.summary || { ready: 0, quarantined: 0, deleted: 0, missing: 0, blocked: 0, errors: 0 };
    var results = $.isArray(response.results) ? response.results : [];
    var hasWarnings = Number(summary.skipped || 0) > 0 || Number(summary.blocked || 0) > 0 || Number(summary.missing || 0) > 0 || Number(summary.errors || 0) > 0;
    var modalTitle = hasWarnings ? context.resultTitleWarning : context.resultTitleSuccess;
    var modalType = hasWarnings ? "warning" : "success";

    if (!context.preview) {
      applyLocalOperationResults(results);
      loadAuditHistory(state.deferredDataRequestToken, true, 25);
    }

    if (response.quarantineSummary) {
      state.quarantine.summary = $.extend({ count: 0, sizeLabel: "0 B" }, response.quarantineSummary);
    } else if (!context.preview) {
      loadQuarantineSummary(state.deferredDataRequestToken, true);
    }

    if (!context.preview && context.baseOperation === "quarantine") {
      state.quarantine.loaded = false;
    }

    swal({
      title: modalTitle,
      text: "",
      type: modalType,
      html: true,
      showCancelButton: false,
      confirmButtonText: ACP.t(strings, "okLabel", "OK")
    });
    ACP.applyDeleteModalClass("acp-delete-modal acp-delete-results-modal", buildOperationResultsHtml(summary, results, context));
    renderAll();
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

        apiPostForUserAction({
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
              html: true,
              showCancelButton: false,
              confirmButtonText: ACP.t(strings, "okLabel", "OK")
            });
            ACP.applyDeleteModalClass(
              "acp-delete-modal acp-delete-results-modal",
              buildOperationResultsHtml(previewSummary, previewResults, buildOperationContext("preview_delete", selectedRows))
            );
            return;
          }

          swal({
            title: getDeleteConfirmationTitle(context),
            text: "",
            type: "warning",
            html: true,
            showCancelButton: true,
            closeOnConfirm: false,
            confirmButtonText: confirmButtonText
          }, function() {
            if (!requireDeleteConfirmationChecked()) {
              return false;
            }

            runCandidateOperation(selectedRows, context.operation);
            return true;
          });
          ACP.applyDeleteModalClass("acp-delete-modal acp-delete-modal-review", buildOperationPreviewHtml(previewResults, context, {
            showConfirmationCheckbox: true
          }));
          syncDeleteConfirmationState();
        }).fail(function(xhr) {
          setBusy(false);
          swal(context.failureTitle, ACP.extractErrorMessage(xhr, ACP.t(strings, "deletePreviewFailedMessage", "The delete preview could not be prepared right now.")), "error");
        });
        return;
      }

      swal({
        title: getDeleteConfirmationTitle(context),
        text: "",
        type: "warning",
        html: true,
        showCancelButton: true,
        closeOnConfirm: false,
        confirmButtonText: confirmButtonText
      }, function() {
        if (!requireDeleteConfirmationChecked()) {
          return false;
        }

        runCandidateOperation(selectedRows, context.operation);
        return true;
      });
      ACP.applyDeleteModalClass("acp-delete-modal acp-delete-modal-review", buildOperationPreviewHtml(selectedRows, context, {
        showConfirmationCheckbox: true
      }));
      syncDeleteConfirmationState();
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
      showConfirmationCheckbox: false
    }));
  }

  function runCandidateOperation(selectedRows, operation) {
    var context = buildOperationContext(operation, selectedRows);
    var useProgressModal = !context.preview && context.baseOperation === "delete";
    var operationProgressId = !context.preview ? createOperationProgressId() : "";
    var requestData;

    setBusy(true);
    context.rows = selectedRows;

    if (useProgressModal) {
      startOperationProgressModal(operationProgressId, context);
    } else {
      ACP.applyDeleteModalClass("");
      swal({
        title: context.loadingTitle,
        text: context.loadingMessage,
        type: "info",
        showConfirmButton: false,
        allowEscapeKey: false,
        allowOutsideClick: false
      });
    }

    if (operationProgressId && !useProgressModal) openRecoveredOperation(operationProgressId);

    requestData = {
      action: "executeCandidateAction",
      scanToken: state.scanToken,
      candidateIds: JSON.stringify($.map(selectedRows, function(row) {
        return row.id;
      })),
      operation: operation
    };

    if (operationProgressId) {
      requestData.operationProgressId = operationProgressId;
    }

    apiPostForUserAction(requestData).done(function(response) {
      setBusy(false);
      if (operationProgressId) {
        state.recovery.activeId = "";
        loadRecentOperations();
      }

      if (useProgressModal) {
        finalizeOperationProgressModal(response, context);
        return;
      }

      showOperationResultsFromResponse(response, context);
    }).fail(function(xhr) {
      var fallbackMessage = ACP.extractErrorMessage(xhr, ACP.t(strings, "scanFailedMessage", "The orphaned appdata scan could not be completed right now."));

      setBusy(false);
      if (useProgressModal) {
        stopOperationProgressPolling();
        state.operationProgress.activeId = "";
        state.operationProgress.pendingResult = null;
      }

      if (operationProgressId && (!xhr || !xhr.status || xhr.status >= 500)) {
        openRecoveredOperation(operationProgressId);
        loadRecentOperations();
        return;
      }

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

    if (!isRestore) {
      html.push(buildDeleteConfirmationHtml(ACP.t(
        strings,
        "quarantinePurgeCheckboxConfirmLabel",
        "I confirm I want to permanently delete the selected quarantined folders. This action cannot be undone by this plugin."
      )));
    }

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

    apiPostForUserAction({
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
      '<div class="acp-modal-subcopy">' + ACP.escapeHtml(ACP.plural("{count} conflicts found.", conflictCount) + (readyCount > 0 ? " " + ACP.plural("{count} selected folders can still restore normally.", readyCount) : "")) + "</div>",
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
      html.push('<span class="acp-modal-stat ' + ACP.escapeHtml(statusMeta.tone) + '">' + ACP.escapeHtml(statusMeta.label) + ": " + ACP.escapeHtml(ACP.formatCount(count)) + "</span>");
    });
    html.push("</div>");
    html.push('<div class="acp-modal-panel">');
    html.push('<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "quarantineManagerTitle", "Quarantine manager")) + "</div>");
    html.push('<ul class="acp-modal-list acp-modal-result-list">');

    var previousGroup = "";
    $.each(orderedActionResults(results), function(_, result) {
      var group = resultGroup(result);
      if (group !== previousGroup) {
        html.push('<li class="acp-modal-panel-title" data-result-group="' + group + '">' + ACP.escapeHtml(group === "failed" ? ACP.tr("Failed") : (group === "skipped" ? ACP.tr("Skipped or blocked") : ACP.tr("Completed"))) + '</li>');
        previousGroup = group;
      }
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
      if (resultNextStep(result)) html.push('<div class="acp-modal-result-message acp-result-next-step">' + ACP.escapeHtml(resultNextStep(result)) + '</div>');
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
        title: confirmTitle,
        text: "",
        type: "warning",
        html: true,
        showCancelButton: true,
        closeOnConfirm: false,
        confirmButtonText: confirmButton
      }, function() {
        if (!requireDeleteConfirmationChecked()) {
          return false;
        }

        runQuarantineManagerAction(requestedEntryIds, action);
        return true;
      });
      ACP.applyDeleteModalClass("acp-delete-modal acp-delete-modal-review", buildQuarantineActionConfirmHtml(entries, action));
      syncDeleteConfirmationState();
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
    var operationProgressId = createOperationProgressId();
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
    openRecoveredOperation(operationProgressId);

    apiPostForUserAction({
      action: "quarantineManagerAction",
      managerAction: action,
      operationProgressId: operationProgressId,
      entryIds: JSON.stringify(entryIds),
      scanToken: state.scanToken,
      restoreConflictMode: requestOptions.restoreConflictMode,
      restoreConflictNames: JSON.stringify(requestOptions.restoreConflictNames || {})
    }).done(function(response) {
      state.recovery.activeId = "";
      loadRecentOperations();
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
      loadAuditHistory(state.deferredDataRequestToken, true, 25);
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

      if (!xhr || !xhr.status || xhr.status >= 500) {
        openRecoveredOperation(operationProgressId);
        loadRecentOperations();
        return;
      }

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
