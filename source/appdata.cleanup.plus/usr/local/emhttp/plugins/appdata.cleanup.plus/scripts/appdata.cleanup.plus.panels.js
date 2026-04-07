(function(window, document, $) {
  "use strict";

  var ACP = window.AppdataCleanupPlus = window.AppdataCleanupPlus || {};

  ACP.formatOperationResultStatus = function(strings, status) {
    switch (status) {
      case "ready":
        return { label: ACP.t(strings, "previewReadyLabel", "Ready"), tone: "is-selected" };
      case "quarantined":
        return { label: ACP.t(strings, "resultQuarantinedLabel", "Quarantined"), tone: "is-safe" };
      case "deleted":
        return { label: ACP.t(strings, "resultDeletedLabel", "Deleted"), tone: "is-selected" };
      case "restored":
        return { label: ACP.t(strings, "resultRestoredLabel", "Restored"), tone: "is-safe" };
      case "purged":
        return { label: ACP.t(strings, "resultPurgedLabel", "Purged"), tone: "is-review" };
      case "skipped":
        return { label: ACP.t(strings, "resultSkippedLabel", "Skipped"), tone: "is-blocked" };
      case "conflict":
        return { label: ACP.t(strings, "resultConflictLabel", "Conflict"), tone: "is-review" };
      case "missing":
        return { label: ACP.t(strings, "resultMissingLabel", "Missing"), tone: "is-blocked" };
      case "blocked":
        return { label: ACP.t(strings, "resultBlockedLabel", "Locked"), tone: "is-review" };
      default:
        return { label: ACP.t(strings, "resultErrorLabel", "Error"), tone: "is-review" };
    }
  };

  ACP.buildLockOverrideButtonState = function(context) {
    var state = context.state || {};
    var strings = context.strings || {};
    var selected = state.selected || {};
    var rows = $.isArray(state.rows) ? state.rows : [];
    var selectedRows = $.grep(rows, function(row) {
      var rowId = String((row && row.id) || "");
      return !!rowId && !!selected[rowId] && !row.ignored && (!!row.canDelete || !!row.lockOverrideAllowed);
    });
    var unlockCount = $.grep(selectedRows, function(row) {
      return !!row.lockOverrideAllowed && !!row.policyLocked && !row.lockOverridden;
    }).length;
    var relockCount = $.grep(selectedRows, function(row) {
      return !!row.lockOverrideAllowed && !!row.lockOverridden;
    }).length;
    var intent = unlockCount > 0 ? "unlock" : (relockCount > 0 ? "relock" : "unlock");

    return {
      disabled: !!state.busy || !state.scanToken || (unlockCount === 0 && relockCount === 0),
      intent: intent,
      label: intent === "relock"
        ? ACP.t(strings, "lockOverrideRelockLabel", "Relock selected")
        : ACP.t(strings, "lockOverrideUnlockLabel", "Unlock selected")
    };
  };

  ACP.syncModeStripLockOverrideButton = function(context) {
    var els = context.els || {};
    var $button = els.$modeStrip ? els.$modeStrip.find("[data-action='toggle-lock-override']").first() : $();
    var buttonState;

    if (!$button.length) {
      return;
    }

    buttonState = ACP.buildLockOverrideButtonState(context);
    $button.text(buttonState.label);
    $button.attr("data-lock-intent", buttonState.intent);
    $button.prop("disabled", !!buttonState.disabled);
  };

  ACP.renderModeStrip = function(context) {
    var state = context.state || {};
    var els = context.els || {};
    var strings = context.strings || {};
    var summary = (state.quarantine && state.quarantine.summary) || { count: 0, sizeLabel: "0 B" };
    var lockOverrideButton = ACP.buildLockOverrideButtonState(context);
    var isDeleteMode = !!(state.settings && state.settings.enablePermanentDelete);
    var leftTitle = isDeleteMode
      ? ACP.t(strings, "noticeDeleteModeTitle", "Permanent delete mode is enabled")
      : ACP.t(strings, "noticeSafeModeTitle", "Safe mode is on");
    var leftMessage = isDeleteMode
      ? ACP.t(strings, "noticeDeleteModeMessage", "Selected folders will be permanently removed after confirmation. Use this mode carefully.")
      : ACP.t(strings, "noticeSafeModeMessage", "The primary action moves selected folders into quarantine instead of permanently deleting them.");
    var managerMessage = summary.count > 0
      ? summary.count + " " + (summary.count === 1 ? ACP.t(strings, "quarantineCountSingular", "quarantined folder") : ACP.t(strings, "quarantineCountPlural", "quarantined folders")) + " tracked"
      : ACP.t(strings, "quarantineSummaryEmpty", "No quarantined folders are tracked right now.");
    var managerMeta = summary.count > 0 && summary.sizeLabel ? " | " + summary.sizeLabel : "";
    var quarantineButtonLabel = state.quarantine && state.quarantine.loading
      ? ACP.t(strings, "quarantineLoadingLabel", "Loading quarantine")
      : ACP.t(strings, "quarantineManagerOpenLabel", "Show quarantine");
    var lockOverrideButtonLabel = lockOverrideButton.label;
    var appdataSourcesButtonLabel = ACP.t(strings, "appdataSourcesOpenLabel", "Appdata sources");
    var auditButtonLabel = ACP.t(strings, "auditHistoryOpenLabel", "Show history");
    var html = [
      '<div class="acp-mode-strip-grid">',
      '<article class="acp-mode-card ' + (isDeleteMode ? "is-delete-mode" : "is-safe-mode") + '">',
      '<div class="acp-mode-card-copy">',
      '<div class="acp-mode-card-title">' + ACP.escapeHtml(leftTitle) + "</div>",
      '<div class="acp-mode-card-message">' + ACP.escapeHtml(leftMessage) + "</div>",
      "</div>",
      "</article>",
      '<article class="acp-mode-card is-manager-card">',
      '<div class="acp-mode-card-copy">',
      '<div class="acp-mode-card-title">' + ACP.escapeHtml(ACP.t(strings, "actionBarTitle", "Action bar")) + "</div>",
      '<div class="acp-mode-card-message">' + ACP.escapeHtml(managerMessage + managerMeta) + "</div>",
      "</div>",
      '<div class="acp-mode-card-actions">',
      '<button type="button" class="acp-button acp-button-secondary" data-action="toggle-lock-override" data-lock-intent="' + ACP.escapeHtml(lockOverrideButton.intent) + '"' + (lockOverrideButton.disabled ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(lockOverrideButtonLabel) + "</button>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="open-appdata-sources">' + ACP.escapeHtml(appdataSourcesButtonLabel) + "</button>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="toggle-quarantine">' + ACP.escapeHtml(quarantineButtonLabel) + "</button>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="open-audit-history">' + ACP.escapeHtml(auditButtonLabel) + "</button>",
      "</div>",
      "</article>",
      "</div>"
    ];

    els.$modeStrip.html(html.join(""));
  };

  ACP.buildQuarantineManagerModalHtml = function(context) {
    var state = context.state || {};
    var strings = context.strings || {};
    var quarantine = state.quarantine || {};
    var entries = $.isArray(quarantine.entries) ? quarantine.entries : [];
    var settings = state.settings || {};
    var defaultPurgeDays = Number(settings.defaultQuarantinePurgeDays || 0);
    var purgeAtInput = String(quarantine.purgeAtInput || "");
    var selected = quarantine.selected || {};
    var allSelected = false;
    var selectedCount = 0;
    var selectionDisabled = false;
    var summary = quarantine.summary || { count: 0, sizeLabel: "0 B" };
    var subtitle = summary.count
      ? (summary.count + " " + (summary.count === 1 ? ACP.t(strings, "quarantineCountSingular", "quarantined folder") : ACP.t(strings, "quarantineCountPlural", "quarantined folders")) + " tracked" + (summary.sizeLabel ? " | " + summary.sizeLabel : ""))
      : ACP.t(strings, "quarantineSummaryEmpty", "No quarantined folders are tracked right now.");
    $.each(entries, function(_, entry) {
      if (selected[String(entry.id || "")]) {
        selectedCount += 1;
      }
    });
    allSelected = entries.length > 0 && selectedCount >= entries.length;
    selectionDisabled = !!quarantine.loading || selectedCount === 0;
    var html = [
      '<div class="acp-modal-summary">',
      '<div class="acp-modal-copy">',
      '<div class="acp-modal-subcopy">' + ACP.escapeHtml(subtitle) + "</div>",
      "</div>",
      '<div class="acp-modal-actions-row acp-quarantine-manager-toolbar">',
      '<div class="acp-modal-subcopy acp-quarantine-selected-summary">' + ACP.escapeHtml(selectedCount + " " + (selectedCount === 1 ? ACP.t(strings, "selectedSingular", "folder selected") : ACP.t(strings, "selectedPlural", "folders selected"))) + "</div>",
      '<div class="acp-quarantine-toolbar-groups">',
      '<div class="acp-modal-inline-actions acp-quarantine-toolbar-primary">',
      '<label class="acp-quarantine-schedule-field">',
      '<span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "quarantinePurgeScheduleDaysLabel", "Purge in days")) + "</span>",
      '<input type="number" min="0" step="1" class="acp-input acp-quarantine-default-purge-input" value="' + ACP.escapeHtml(String(defaultPurgeDays >= 0 ? defaultPurgeDays : 0)) + '"' + (quarantine.loading ? ' disabled="disabled"' : "") + '>',
      "</label>",
      '<label class="acp-quarantine-schedule-field acp-quarantine-schedule-at-field">',
      '<span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "quarantinePurgeScheduleAtLabel", "Set purge at")) + "</span>",
      '<input type="datetime-local" class="acp-input acp-quarantine-schedule-at-input" value="' + ACP.escapeHtml(purgeAtInput) + '"' + (quarantine.loading ? ' disabled="disabled"' : "") + '>',
      "</label>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="set-quarantine-purge-schedule"' + (selectionDisabled ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(ACP.t(strings, "quarantinePurgeScheduleSetLabel", "Set purge")) + "</button>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="clear-quarantine-purge-schedule"' + (selectionDisabled ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(ACP.t(strings, "quarantinePurgeScheduleClearLabel", "Clear purge timer")) + "</button>",
      "</div>",
      '<div class="acp-modal-inline-actions acp-quarantine-toolbar-secondary">',
      '<button type="button" class="acp-button acp-button-secondary" data-action="refresh-quarantine"' + (quarantine.loading ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(ACP.t(strings, "quarantineRefreshLabel", "Refresh")) + "</button>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="select-all-quarantine"' + (quarantine.loading || !entries.length || allSelected ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(ACP.t(strings, "selectAllLabel", "Select all")) + "</button>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="clear-quarantine-selection"' + (selectionDisabled ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(ACP.t(strings, "clearLabel", "Clear")) + "</button>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="restore-selected-quarantine"' + (selectionDisabled ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(ACP.t(strings, "restoreSelectedLabel", "Restore selected")) + "</button>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="purge-selected-quarantine"' + (selectionDisabled ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(ACP.t(strings, "purgeSelectedLabel", "Purge selected")) + "</button>",
      "</div>",
      "</div>",
      "</div>",
      '<div class="acp-modal-panel">',
      '<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "quarantineTrackedTitle", "Tracked folders")) + "</div>"
    ];

    if (quarantine.loading) {
      html.push('<div class="acp-utility-empty">' + ACP.escapeHtml(ACP.t(strings, "quarantineLoadingMessage", "Reviewing tracked quarantined folders.")) + "</div>");
    } else if (!entries.length) {
      html.push('<div class="acp-utility-empty">' + ACP.escapeHtml(ACP.t(strings, "quarantineEmptyMessage", "Tracked quarantine entries will appear here once folders are moved into quarantine.")) + "</div>");
    } else {
      html.push('<ul class="acp-modal-list acp-modal-result-list">');
      $.each(entries, function(_, entry) {
        var entryId = String(entry.id || "");
        var isSelected = !!selected[entryId];
        html.push('<li class="acp-modal-result acp-quarantine-entry' + (isSelected ? ' is-selected' : "") + '" data-entry-id="' + ACP.escapeHtml(entryId) + '">');
        html.push('<div class="acp-modal-result-head">');
        html.push('<div class="acp-quarantine-entry-main">');
        html.push('<label class="acp-quarantine-entry-check">');
        html.push('<input type="checkbox" class="acp-quarantine-checkbox" data-entry-id="' + ACP.escapeHtml(entryId) + '"' + (isSelected ? ' checked="checked"' : "") + ">");
        html.push("</label>");
        html.push('<div class="acp-quarantine-title-wrap">');
        html.push('<div class="acp-modal-inline-title">' + ACP.escapeHtml(entry.name || entry.sourcePath || "") + "</div>");
        if (entry.purgeScheduled && entry.purgeBadgeLabel) {
          html.push('<div class="acp-quarantine-meta-badges">');
          html.push('<span class="acp-modal-stat ' + ACP.escapeHtml(entry.purgeBadgeTone || "is-selected") + '" title="' + ACP.escapeHtml(ACP.t(strings, "quarantinePurgeScheduledLabel", "Scheduled purge") + (entry.purgeAtLabel ? ": " + entry.purgeAtLabel : "")) + '">' + ACP.escapeHtml(entry.purgeBadgeLabel) + "</span>");
          if (entry.purgeAtLabel) {
            html.push('<span class="acp-modal-stat is-scheduled" title="' + ACP.escapeHtml(ACP.t(strings, "quarantinePurgeScheduledLabel", "Scheduled purge")) + '">' + ACP.escapeHtml(entry.purgeAtLabel) + "</span>");
          }
          html.push("</div>");
        }
        html.push("</div>");
        html.push("</div>");
        html.push('<div class="acp-modal-inline-actions">');
        html.push('<button type="button" class="acp-button acp-button-secondary" data-entry-action="restore" data-entry-id="' + ACP.escapeHtml(entryId) + '">' + ACP.escapeHtml(ACP.t(strings, "quarantineRestoreActionLabel", "Restore")) + "</button>");
        html.push('<button type="button" class="acp-button acp-button-secondary" data-entry-action="purge" data-entry-id="' + ACP.escapeHtml(entryId) + '">' + ACP.escapeHtml(ACP.t(strings, "quarantinePurgeActionLabel", "Purge")) + "</button>");
        html.push("</div>");
        html.push("</div>");
        html.push('<div class="acp-modal-result-message">' + ACP.escapeHtml((entry.quarantinedAtLabel || "") + (entry.quarantinedAgeLabel ? " | " + entry.quarantinedAgeLabel : "") + (entry.sizeLabel ? " | " + entry.sizeLabel : "")) + "</div>");
        html.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "quarantineSourceLabel", "Original")) + '</span><code class="acp-modal-path">' + ACP.escapeHtml(entry.sourcePath || "") + "</code></div>");
        html.push('<div class="acp-modal-result-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "quarantineLocationLabel", "Quarantine path")) + '</span><code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(entry.destination || "") + "</code></div>");
        html.push("</li>");
      });
      html.push("</ul>");
    }

    html.push("</div></div>");
    return html.join("");
  };

  ACP.buildAuditHistoryModalHtml = function(context) {
    var state = context.state || {};
    var strings = context.strings || {};
    var auditHistory = $.isArray(state.auditHistory) ? state.auditHistory : [];
    var subtitle = auditHistory.length
      ? (auditHistory.length + " " + ACP.t(strings, "auditHistoryEntriesLabel", "entries available"))
      : ACP.t(strings, "auditHistoryEmptySummary", "No cleanup history has been recorded yet.");
    var html = [
      '<div class="acp-modal-summary">',
      '<div class="acp-modal-copy">',
      '<div class="acp-modal-subcopy">' + ACP.escapeHtml(subtitle) + "</div>",
      "</div>",
      '<div class="acp-modal-panel acp-modal-panel-scroll">',
      '<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "auditHistoryTitle", "Audit history")) + "</div>"
    ];

    if (!auditHistory.length) {
      html.push('<div class="acp-utility-empty">' + ACP.escapeHtml(ACP.t(strings, "auditHistoryEmptyMessage", "No cleanup, restore, or purge actions have been recorded yet.")) + "</div>");
    } else {
      html.push('<div class="acp-audit-list">');
      $.each(auditHistory, function(_, entry) {
        html.push('<article class="acp-audit-entry">');
        html.push('<div class="acp-audit-head">');
        html.push('<div class="acp-audit-head-main">');
        html.push('<span class="acp-modal-stat is-selected">' + ACP.escapeHtml(entry.operationLabel || "") + "</span>");
        html.push('<span class="acp-audit-time">' + ACP.escapeHtml(entry.timestampLabel || entry.timestamp || "") + "</span>");
        if (entry.relativeLabel) {
          html.push('<span class="acp-audit-time-muted">' + ACP.escapeHtml(entry.relativeLabel) + "</span>");
        }
        html.push("</div>");
        html.push('<div class="acp-audit-head-meta">' + ACP.escapeHtml(String(entry.requestedCount || 0)) + " " + ACP.escapeHtml(ACP.t(strings, "auditRequestedLabel", "items submitted")) + "</div>");
        html.push("</div>");
        html.push('<div class="acp-audit-message">' + ACP.escapeHtml(entry.message || "") + "</div>");
        html.push('<div class="acp-modal-stats">');
        $.each(entry.summary || {}, function(status, count) {
          var statusMeta;
          if (!count) {
            return;
          }
          statusMeta = ACP.formatOperationResultStatus(strings, status);
          html.push('<span class="acp-modal-stat ' + ACP.escapeHtml(statusMeta.tone) + '">' + ACP.escapeHtml(statusMeta.label) + ": " + ACP.escapeHtml(String(count)) + "</span>");
        });
        html.push("</div>");

        if ($.isArray(entry.results) && entry.results.length) {
          html.push('<div class="acp-audit-results">');
          $.each(entry.results, function(_, result) {
            var statusMeta = ACP.formatOperationResultStatus(strings, result.status);
            html.push('<div class="acp-audit-result">');
            html.push('<div class="acp-audit-result-head"><span class="acp-modal-stat ' + ACP.escapeHtml(statusMeta.tone) + '">' + ACP.escapeHtml(statusMeta.label) + "</span></div>");
            html.push('<code class="acp-modal-path">' + ACP.escapeHtml(result.displayPath || result.sourcePath || result.path || result.destination || "") + "</code>");
            if (result.destination && result.destination !== (result.displayPath || result.path || "")) {
              html.push('<div class="acp-audit-destination"><span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "destinationLabel", "Destination")) + '</span><code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(result.destination) + "</code></div>");
            }
            if (result.message) {
              html.push('<div class="acp-audit-result-message">' + ACP.escapeHtml(result.message) + "</div>");
            }
            html.push("</div>");
          });
          html.push("</div>");
        }

        html.push("</article>");
      });
      html.push("</div>");
    }

    html.push("</div></div>");
    return html.join("");
  };

  ACP.buildAppdataSourcesModalHtml = function(context) {
    var state = context.state || {};
    var strings = context.strings || {};
    var settings = state.settings || {};
    var sourceInfo = state.appdataSources || {};
    var browser = state.appdataSourceBrowser || {};
    var detected = $.isArray(sourceInfo.detected) ? sourceInfo.detected : [];
    var manual = $.isArray(browser.manual) ? browser.manual : ($.isArray(settings.manualAppdataSources) ? settings.manualAppdataSources : []);
    var effective = [];
    var effectiveSeen = {};
    var breadcrumbs = $.isArray(browser.breadcrumbs) ? browser.breadcrumbs : [];
    var entries = $.isArray(browser.entries) ? browser.entries : [];
    var currentPath = String(browser.currentPath || browser.root || "/mnt");
    var feedbackMessage = String(browser.feedbackMessage || "");
    var currentValidationMessage = String(browser.validationMessage || "");
    var alreadyAdded = $.inArray(currentPath, manual) !== -1;
    var canAddCurrentPath = !!browser.canAdd && !alreadyAdded;
    var disabledAttr = (state.busy || browser.loading) ? ' disabled="disabled"' : "";
    var pathStatusMessage = "";
    var pathStatusClass = "acp-appdata-browser-status";
    var breadcrumbHtml = [];
    var manualHtml = [];
    var entryHtml = [];
    var html = [
      '<div class="acp-modal-summary">',
      '<div class="acp-modal-copy">',
      '<div class="acp-modal-subcopy">' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesLead", "The Docker appdata root is auto-detected when available. Browse to a non-standard appdata location, then add it to the manual source list.")) + "</div>",
      '<div class="acp-modal-hint">' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesHint", "Only add dedicated appdata roots. Direct child folders under each root are treated as discovery candidates.")) + "</div>",
      "</div>",
      '<div class="acp-modal-actions-row">',
      '<button type="button" class="acp-button acp-button-secondary" data-action="save-appdata-sources"' + disabledAttr + '>' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesSaveLabel", "Save sources")) + "</button>",
      "</div>",
      "</div>",
      '<div class="acp-modal-panel">',
      '<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesDetectedTitle", "Detected source")) + "</div>"
    ];

    $.each(detected.concat(manual), function(_, path) {
      var normalizedPath = $.trim(String(path || ""));

      if (!normalizedPath || effectiveSeen[normalizedPath]) {
        return;
      }

      effectiveSeen[normalizedPath] = true;
      effective.push(normalizedPath);
    });

    if (!detected.length) {
      html.push('<div class="acp-utility-empty">' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesDetectedEmpty", "No Docker appdata source is auto-detected right now.")) + "</div>");
    } else {
      html.push('<div class="acp-appdata-source-list">');
      $.each(detected, function(_, path) {
        html.push('<code class="acp-modal-path">' + ACP.escapeHtml(path || "") + "</code>");
      });
      html.push("</div>");
    }

    if (browser.loading) {
      pathStatusMessage = ACP.t(strings, "appdataSourcesBrowseLoadingMessage", "Loading folders from the selected path.");
      pathStatusClass += " is-loading";
    } else if (alreadyAdded) {
      pathStatusMessage = ACP.t(strings, "appdataSourcesAlreadyAddedMessage", "This path is already in the manual source list.");
      pathStatusClass += " is-info";
    } else if (browser.canAdd) {
      pathStatusMessage = ACP.t(strings, "appdataSourcesReadyMessage", "This path can be added as a manual appdata source.");
      pathStatusClass += " is-ready";
    } else if (currentValidationMessage) {
      pathStatusMessage = currentValidationMessage;
      pathStatusClass += " is-warning";
    }

    $.each(manual, function(_, path) {
      manualHtml.push(
        '<div class="acp-appdata-source-manual-item">' +
          '<code class="acp-modal-path">' + ACP.escapeHtml(path || "") + "</code>" +
          '<button type="button" class="acp-button acp-button-secondary" data-action="remove-manual-appdata-source" data-path="' + ACP.escapeHtml(path || "") + '"' + disabledAttr + '>' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesRemoveLabel", "Remove")) + "</button>" +
        "</div>"
      );
    });

    $.each(breadcrumbs, function(_, crumb) {
      breadcrumbHtml.push(
        '<button type="button" class="acp-button acp-button-secondary acp-appdata-breadcrumb" data-action="browse-appdata-source" data-path="' + ACP.escapeHtml(String((crumb && crumb.path) || "")) + '"' + disabledAttr + '>' + ACP.escapeHtml(String((crumb && crumb.label) || "")) + "</button>"
      );
    });

    $.each(entries, function(_, entry) {
      entryHtml.push(
        '<button type="button" class="acp-appdata-browser-entry" data-action="browse-appdata-source" data-path="' + ACP.escapeHtml(String((entry && entry.path) || "")) + '"' + disabledAttr + '>' +
          '<span class="acp-appdata-browser-entry-name">' + ACP.escapeHtml(String((entry && entry.name) || "")) + "</span>" +
          '<span class="acp-appdata-browser-entry-path">' + ACP.escapeHtml(String((entry && entry.path) || "")) + "</span>" +
        "</button>"
      );
    });

    html.push(
      "</div>",
      '<div class="acp-modal-panel">',
      '<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesManualTitle", "Manual source paths")) + "</div>",
      manualHtml.length
        ? ('<div class="acp-appdata-source-manual-list">' + manualHtml.join("") + "</div>")
        : ('<div class="acp-utility-empty">' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesManualEmpty", "No manual appdata source paths have been added yet.")) + "</div>"),
      '<div class="acp-appdata-browser-toolbar">',
      '<button type="button" class="acp-button acp-button-secondary" data-action="browse-appdata-source-parent"' + ((!browser.parentPath || state.busy || browser.loading) ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesBrowseUpLabel", "Up")) + "</button>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="add-current-appdata-source"' + ((!canAddCurrentPath || state.busy || browser.loading) ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesAddCurrentLabel", "Add selected path")) + "</button>",
      "</div>",
      '<div class="acp-appdata-browser-current">',
      '<div class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesCurrentPathLabel", "Current path")) + "</div>",
      '<code class="acp-modal-path">' + ACP.escapeHtml(currentPath) + "</code>",
      "</div>",
      breadcrumbHtml.length
        ? ('<div class="acp-appdata-breadcrumbs">' + breadcrumbHtml.join("") + "</div>")
        : "",
      '<div class="' + ACP.escapeHtml(pathStatusClass) + '">' + ACP.escapeHtml(pathStatusMessage || ACP.t(strings, "appdataSourcesManualHint", "Select a folder path and add it when you reach the full appdata root.")) + "</div>",
      entryHtml.length
        ? ('<div class="acp-appdata-browser-list">' + entryHtml.join("") + "</div>")
        : ('<div class="acp-utility-empty">' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesBrowseEmptyMessage", "No child folders are available under the current path.")) + "</div>"),
      '<div class="acp-modal-feedback" data-role="appdata-sources-feedback">' + ACP.escapeHtml(feedbackMessage) + "</div>",
      "</div>",
      '<div class="acp-modal-panel">',
      '<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesEffectiveTitle", "Effective scan roots")) + "</div>"
    );

    if (!effective.length) {
      html.push('<div class="acp-utility-empty">' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesEffectiveEmpty", "No appdata sources are currently available.")) + "</div>");
    } else {
      html.push('<div class="acp-appdata-source-list">');
      $.each(effective, function(_, path) {
        html.push('<code class="acp-modal-path">' + ACP.escapeHtml(path || "") + "</code>");
      });
      html.push("</div>");
    }

    html.push("</div>");
    return html.join("");
  };
})(window, document, jQuery);
