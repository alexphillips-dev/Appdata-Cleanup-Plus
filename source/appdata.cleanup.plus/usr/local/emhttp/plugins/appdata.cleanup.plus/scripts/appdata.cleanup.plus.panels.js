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
    var settings = state.settings || {};
    var summary = (state.quarantine && state.quarantine.summary) || { count: 0, sizeLabel: "0 B" };
    var lockOverrideButton = ACP.buildLockOverrideButtonState(context);
    var isDeleteMode = !!(state.settings && state.settings.enablePermanentDelete);
    var showZfsPathMappingsButton = !!settings.enableZfsDatasetDelete;
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
    var zfsPathMappingsButtonLabel = ACP.t(strings, "zfsPathMappingsOpenLabel", "ZFS mappings");
    var auditButtonLabel = ACP.t(strings, "auditHistoryOpenLabel", "Show history");
    var toolsButtonLabel = ACP.t(strings, "toolsOpenLabel", "Tools");
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
      showZfsPathMappingsButton
        ? ('<button type="button" class="acp-button acp-button-secondary" data-action="open-zfs-path-mappings">' + ACP.escapeHtml(zfsPathMappingsButtonLabel) + "</button>")
        : "",
      '<button type="button" class="acp-button acp-button-secondary" data-action="toggle-quarantine">' + ACP.escapeHtml(quarantineButtonLabel) + "</button>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="open-audit-history">' + ACP.escapeHtml(auditButtonLabel) + "</button>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="open-tools">' + ACP.escapeHtml(toolsButtonLabel) + "</button>",
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

  function buildModalFieldHtml(label, value, options) {
    var settings = $.isPlainObject(options) ? options : {};
    var text = $.trim(String(value || ""));

    if (!text) {
      text = ACP.t(settings.strings || {}, "rowDetailsNoneLabel", "None");
    }

    return (
      '<div class="acp-detail-item">' +
        '<div class="acp-detail-label">' + ACP.escapeHtml(label || "") + "</div>" +
        (
          settings.code
            ? ('<code class="acp-modal-path' + (settings.secondary ? ' acp-modal-path-secondary' : '') + '">' + ACP.escapeHtml(text) + "</code>")
            : ('<div class="acp-detail-value">' + ACP.escapeHtml(text) + "</div>")
        ) +
      "</div>"
    );
  }

  function buildModalFieldListHtml(items) {
    var html = ['<div class="acp-detail-list">'];

    $.each(items || [], function(_, item) {
      if (!item || !item.label) {
        return;
      }

      if ($.isArray(item.values)) {
        var values = $.grep($.map(item.values, function(value) {
          return $.trim(String(value || ""));
        }), function(value) {
          return !!value;
        });

        if (!values.length) {
          html.push(buildModalFieldHtml(item.label, "", item));
          return;
        }

        html.push(
          '<div class="acp-detail-item">' +
            '<div class="acp-detail-label">' + ACP.escapeHtml(item.label || "") + "</div>" +
            '<div class="acp-detail-stack">' +
              $.map(values, function(value) {
                return item.code
                  ? ('<code class="acp-modal-path' + (item.secondary ? ' acp-modal-path-secondary' : '') + '">' + ACP.escapeHtml(value) + "</code>")
                  : ('<div class="acp-detail-value">' + ACP.escapeHtml(value) + "</div>");
              }).join("") +
            "</div>" +
          "</div>"
        );
        return;
      }

      html.push(buildModalFieldHtml(item.label, item.value, item));
    });

    html.push("</div>");
    return html.join("");
  }

  function getRowDetailsOutcome(strings, row) {
    if (row.ignored) {
      return ACP.t(strings, "rowDetailsOutcomeIgnored", "Ignored until restored");
    }

    if (row.securityLockReason || row.risk === "blocked") {
      return ACP.t(strings, "rowDetailsOutcomeHardLocked", "Hard-locked by safety rules");
    }

    if (row.storageKind === "zfs" && row.policyLocked) {
      if (!row.enableZfsDatasetDelete) {
        return ACP.t(strings, "rowDetailsOutcomeZfsDisabled", "Blocked until ZFS dataset delete is enabled");
      }

      if (!row.enablePermanentDelete) {
        return ACP.t(strings, "rowDetailsOutcomePermanentDeleteRequired", "Blocked until permanent delete mode is enabled");
      }
    }

    if (row.policyLocked && row.lockOverrideAllowed && !row.lockOverridden) {
      return ACP.t(strings, "rowDetailsOutcomePolicyLocked", "Locked by current safety policy");
    }

    if (row.lockOverridden) {
      return ACP.t(strings, "rowDetailsOutcomeUnlocked", "Temporarily unlocked for this scan");
    }

    if (row.zfsMappingMatched && row.storageKind !== "zfs") {
      return ACP.t(strings, "rowDetailsOutcomeMappedNoExactDataset", "Mapped share path did not resolve to an exact dataset");
    }

    if (row.storageKind === "zfs") {
      return ACP.t(strings, "rowDetailsOutcomeZfsReady", "Ready for ZFS dataset destroy");
    }

    if (row.risk === "review") {
      return ACP.t(strings, "rowDetailsOutcomeReview", "Review row is currently actionable");
    }

    return ACP.t(strings, "rowDetailsOutcomeReady", "Ready under current safety settings");
  }

  function getRowDetailsNextStep(strings, row) {
    if (row.ignored) {
      return ACP.t(strings, "rowDetailsNextStepIgnored", "Use Restore if you want this path to appear in cleanup scans again.");
    }

    if (row.securityLockReason || row.risk === "blocked") {
      return ACP.t(strings, "rowDetailsNextStepHardLocked", "No action is available here. The path resolves to a managed or unsafe target.");
    }

    if (row.storageKind === "zfs" && !row.enableZfsDatasetDelete) {
      return ACP.t(strings, "rowDetailsNextStepEnableZfs", "Turn on Enable ZFS dataset delete in Safety settings, then rescan if needed.");
    }

    if (row.storageKind === "zfs" && !row.enablePermanentDelete) {
      return ACP.t(strings, "rowDetailsNextStepEnablePermanentDelete", "Turn on Enable permanent delete. ZFS-backed rows cannot be quarantined.");
    }

    if (row.policyLocked && row.lockOverrideAllowed && !row.lockOverridden) {
      return ACP.t(strings, "rowDetailsNextStepUnlock", "Select this row and use Unlock selected if you want to act on it during this scan.");
    }

    if (row.lockOverridden) {
      return ACP.t(strings, "rowDetailsNextStepUnlocked", "Proceed carefully. Rescanning will restore the normal policy lock.");
    }

    if (row.zfsMappingMatched && row.storageKind !== "zfs") {
      return ACP.t(strings, "rowDetailsNextStepMappedNoExactDataset", "Correct the ZFS mapping so the dataset mount root matches exactly, or continue as a normal folder.");
    }

    if (row.storageKind === "zfs") {
      return ACP.t(strings, "rowDetailsNextStepZfsReady", "Only permanent delete mode is supported for ZFS-backed rows. Review the destroy impact below before proceeding.");
    }

    if (row.risk === "review") {
      return ACP.t(strings, "rowDetailsNextStepReview", "Confirm that this path really belongs to orphaned appdata before acting on it.");
    }

    return ACP.t(strings, "rowDetailsNextStepReady", "You can quarantine it now, or permanently delete it if that mode is enabled.");
  }

  ACP.buildToolsModalHtml = function(context) {
    var strings = context.strings || {};

    return [
      '<div class="acp-modal-summary">',
      '<div class="acp-modal-copy">',
      '<div class="acp-modal-subcopy">' + ACP.escapeHtml(ACP.t(strings, "toolsSubtitle", "Support and maintainer utilities for exporting the current plugin state.")) + "</div>",
      '</div>',
      '<div class="acp-modal-panel">',
      '<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "toolsDiagnosticsTitle", "Export diagnostics")) + "</div>",
      '<div class="acp-modal-subcopy">' + ACP.escapeHtml(ACP.t(strings, "toolsDiagnosticsMessage", "Downloads a JSON snapshot of the current scan, safety settings, source roots, notices, quarantine summary, audit history, and row metadata for troubleshooting.")) + "</div>",
      '<div class="acp-modal-subcopy">' + ACP.escapeHtml(ACP.t(strings, "toolsDiagnosticsPrivacyNote", "Diagnostics include app names and filesystem paths. Review before sharing.")) + "</div>",
      '<div class="acp-modal-actions-row">',
      '<button type="button" class="acp-button acp-button-secondary" data-action="export-diagnostics">' + ACP.escapeHtml(ACP.t(strings, "toolsDiagnosticsExportLabel", "Download diagnostics")) + "</button>",
      "</div>",
      "</div>",
      '<div class="acp-modal-panel">',
      '<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "toolsSupportSummaryTitle", "Copy support summary")) + "</div>",
      '<div class="acp-modal-subcopy">' + ACP.escapeHtml(ACP.t(strings, "toolsSupportSummaryMessage", "Copies a concise support summary with version, scan counts, safety toggles, scan roots, ZFS state, and quarantine totals for forum posts or issue reports.")) + "</div>",
      '<div class="acp-modal-actions-row">',
      '<button type="button" class="acp-button acp-button-secondary" data-action="copy-support-summary">' + ACP.escapeHtml(ACP.t(strings, "toolsSupportSummaryCopyLabel", "Copy support summary")) + "</button>",
      "</div>",
      "</div>",
      "</div>"
    ].join("");
  };

  ACP.buildRowDetailsModalHtml = function(context, row) {
    var strings = context.strings || {};
    var settings = (context.state && context.state.settings) || {};
    var summaryStats = [];
    var templateRefs = $.isArray(row.templateRefs) ? row.templateRefs : [];
    var sourceNames = $.isArray(row.sourceNames) ? row.sourceNames : [];
    var targetPaths = $.isArray(row.targetPaths) ? row.targetPaths : [];
    var childDatasets = $.isArray(row.zfsChildDatasets) ? row.zfsChildDatasets : [];
    var snapshots = $.isArray(row.zfsSnapshots) ? row.zfsSnapshots : [];
    var resolutionVariants = $.isArray(row.zfsResolutionVariants) ? row.zfsResolutionVariants : [];
    var riskTone = row.policyLocked || row.risk === "blocked"
      ? "is-blocked"
      : (row.risk === "review" ? "is-review" : "is-safe");
    var summaryMessage = row.policyReason || row.securityLockReason || row.riskReason || row.reason || "";
    var nextStepMessage = getRowDetailsNextStep(strings, $.extend({}, row, settings));
    var storageItems = [
      { label: ACP.t(strings, "rowDetailsStorageKindLabel", "Storage kind"), value: row.storageLabel || row.storageKind || "" },
      { label: ACP.t(strings, "rowDetailsDatasetLabel", "Dataset"), value: row.datasetName || "" },
      { label: ACP.t(strings, "rowDetailsMountpointLabel", "Mountpoint"), value: row.datasetMountpoint || "", code: true },
      { label: ACP.t(strings, "rowDetailsMatchedShareRootLabel", "Matched share root"), value: row.zfsMatchedShareRoot || "", code: true },
      { label: ACP.t(strings, "rowDetailsMatchedDatasetRootLabel", "Matched dataset root"), value: row.zfsMatchedDatasetRoot || "", code: true },
      { label: ACP.t(strings, "rowDetailsResolutionLabel", "Resolution"), value: row.zfsResolutionDetail || row.zfsResolutionMessage || (row.zfsMappingMatched ? ACP.t(strings, "rowDetailsYesLabel", "Yes") : ACP.t(strings, "rowDetailsNoLabel", "No")) },
      { label: ACP.t(strings, "rowDetailsCheckedPathsLabel", "Checked paths"), values: resolutionVariants, code: true }
    ];
    var html = [
      '<div class="acp-modal-summary">',
      '<div class="acp-modal-copy">',
      '<div class="acp-modal-subcopy">' + ACP.escapeHtml(summaryMessage || ACP.t(strings, "rowDetailsSummaryTitle", "Why this row looks the way it does")) + "</div>",
      '<div class="acp-modal-hint">' + ACP.escapeHtml(nextStepMessage) + "</div>",
      "</div>",
      '<div class="acp-modal-stats">'
    ];

    summaryStats.push('<span class="acp-modal-stat ' + ACP.escapeHtml(riskTone) + '">' + ACP.escapeHtml((row.riskLabel || row.risk || "").toString()) + "</span>");
    summaryStats.push('<span class="acp-modal-stat">' + ACP.escapeHtml(row.statusLabel || row.status || "") + "</span>");
    if (row.storageKind === "zfs") {
      summaryStats.push('<span class="acp-modal-stat is-selected">' + ACP.escapeHtml(row.datasetName || ACP.t(strings, "badgeStorageZfs", "ZFS dataset")) + "</span>");
    } else if (row.zfsMappingMatched) {
      summaryStats.push('<span class="acp-modal-stat is-scheduled">' + ACP.escapeHtml(ACP.t(strings, "scanSummaryMappedLabel", "Mapped share path")) + "</span>");
    }
    html.push(summaryStats.join(""));
    html.push("</div>");

    html.push('<div class="acp-modal-panel">');
    html.push('<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "rowDetailsExplanationTitle", "Current explanation")) + "</div>");
    html.push(buildModalFieldListHtml([
      { label: ACP.t(strings, "rowDetailsOutcomeLabel", "Current outcome"), value: getRowDetailsOutcome(strings, $.extend({}, row, settings)) },
      { label: ACP.t(strings, "rowDetailsWhyLabel", "Why"), value: summaryMessage || row.reason || "" },
      { label: ACP.t(strings, "rowDetailsNextStepLabel", "Next step"), value: nextStepMessage }
    ]));
    html.push("</div>");

    html.push('<div class="acp-modal-panel">');
    html.push('<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "rowDetailsPathTitle", "Paths")) + "</div>");
    html.push(buildModalFieldListHtml([
      { label: ACP.t(strings, "rowDetailsCurrentPathLabel", "Current path"), value: row.displayPath || row.path || "", code: true },
      { label: ACP.t(strings, "rowDetailsRealPathLabel", "Canonical path"), value: row.realPath || "", code: true, secondary: true },
      { label: ACP.t(strings, "rowDetailsSourceRootLabel", "Matched source root"), value: row.sourceRoot || "", code: true }
    ]));
    html.push("</div>");

    html.push('<div class="acp-modal-panel">');
    html.push('<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "rowDetailsSourceTitle", "Source evidence")) + "</div>");
    html.push(buildModalFieldListHtml([
      { label: ACP.t(strings, "sourceLabel", "Source"), value: row.sourceDisplay || row.sourceSummary || "" },
      { label: ACP.t(strings, "rowDetailsSourceNamesLabel", "Source names"), value: sourceNames.join(", ") },
      { label: ACP.t(strings, "rowDetailsTargetsLabel", "Targets"), value: targetPaths.join(", ") },
      { label: ACP.t(strings, "rowDetailsTemplateRefsLabel", "Template refs"), value: templateRefs.length ? $.map(templateRefs, function(ref) { return (ref && ref.name ? ref.name : "") + (ref && ref.target ? " -> " + ref.target : ""); }).join(", ") : "" }
    ]));
    html.push("</div>");

    html.push('<div class="acp-modal-panel">');
    html.push('<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "rowDetailsSafetyTitle", "Safety and actionability")) + "</div>");
    html.push(buildModalFieldListHtml([
      { label: ACP.t(strings, "rowDetailsRiskLabel", "Risk"), value: row.riskLabel || row.risk || "" },
      { label: ACP.t(strings, "rowDetailsStatusLabel", "Status"), value: row.statusLabel || row.status || "" },
      { label: ACP.t(strings, "rowDetailsPolicyLabel", "Policy"), value: row.policyReason || "" },
      { label: ACP.t(strings, "rowDetailsSecurityLabel", "Security"), value: row.securityLockReason || row.riskReason || "" },
      { label: ACP.t(strings, "rowDetailsInsideSourceLabel", "Inside configured source"), value: row.insideConfiguredSource ? ACP.t(strings, "rowDetailsYesLabel", "Yes") : ACP.t(strings, "rowDetailsNoLabel", "No") },
      { label: ACP.t(strings, "rowDetailsInsideShareLabel", "Inside default share"), value: row.insideDefaultShare ? ACP.t(strings, "rowDetailsYesLabel", "Yes") : ACP.t(strings, "rowDetailsNoLabel", "No") },
      { label: ACP.t(strings, "rowDetailsShareLabel", "Share"), value: row.shareName || "" },
      { label: ACP.t(strings, "rowDetailsDepthLabel", "Depth"), value: row.depth === null || row.depth === undefined ? "" : String(row.depth) }
    ]));
    html.push("</div>");

    html.push('<div class="acp-modal-panel">');
    html.push('<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "rowDetailsStorageTitle", "Storage")) + "</div>");
    if (row.storageKind === "zfs") {
      storageItems.push({
        label: ACP.t(strings, "rowDetailsDestroyModeLabel", "Destroy mode"),
        value: row.detailLoading
          ? ACP.t(strings, "rowDetailsLoadingLabel", "Loading latest ZFS detail...")
          : (row.zfsPreviewError
            ? row.zfsPreviewError
            : (row.zfsPreviewLoaded
              ? (row.zfsRecursiveDestroy ? ACP.t(strings, "zfsRecursiveDestroyValue", "Recursive destroy") : ACP.t(strings, "zfsStandardDestroyValue", "Standard destroy"))
              : ACP.t(strings, "rowDetailsZfsPreviewPending", "Open details again if you need a fresh ZFS destroy preview.")))
      });
      storageItems.push({
        label: ACP.t(strings, "rowDetailsImpactLabel", "Destroy impact"),
        value: row.detailLoading
          ? ACP.t(strings, "rowDetailsLoadingLabel", "Loading latest ZFS detail...")
          : (row.zfsImpactSummary || (row.zfsPreviewLoaded ? ACP.t(strings, "rowDetailsNoImpactLabel", "No descendant datasets or snapshots are currently expected.") : ""))
      });
      storageItems.push({
        label: ACP.t(strings, "zfsChildDatasetsLabel", "Child datasets"),
        values: childDatasets.length ? childDatasets : [],
        code: true
      });
      storageItems.push({
        label: ACP.t(strings, "zfsSnapshotsLabel", "Snapshots"),
        values: snapshots.length ? snapshots : [],
        code: true
      });
    } else {
      storageItems.push({ label: ACP.t(strings, "rowDetailsMappingLabel", "ZFS mapping"), value: row.zfsResolutionDetail || row.zfsResolutionMessage || (row.zfsMappingMatched ? ACP.t(strings, "rowDetailsYesLabel", "Yes") : ACP.t(strings, "rowDetailsNoLabel", "No")) });
    }

    html.push(buildModalFieldListHtml(storageItems));
    html.push("</div>");

    html.push('<div class="acp-modal-panel">');
    html.push('<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "rowDetailsStatsTitle", "Stats")) + "</div>");
    html.push(buildModalFieldListHtml([
      { label: ACP.t(strings, "sizeLabel", "Size"), value: row.sizeLabel || "" },
      { label: ACP.t(strings, "updatedLabel", "Updated"), value: row.lastModifiedExact || row.lastModifiedLabel || "" }
    ]));
    html.push("</div>");
    html.push("</div>");

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
    var browserEntryAttr = (state.busy || browser.loading)
      ? ' aria-disabled="true" tabindex="-1"'
      : ' role="button" tabindex="0"';
    var pathStatusMessage = "";
    var pathStatusClass = "acp-appdata-browser-status";
    var trailHtml = [];
    var manualHtml = [];
    var entryHtml = [];
    var browserListHtml = [];
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
      trailHtml.push(
        '<span class="acp-appdata-browser-trail-part">' + ACP.escapeHtml(String((crumb && crumb.label) || "")) + "</span>"
      );
    });

    if (browser.parentPath) {
      browserListHtml.push(
        '<div class="acp-appdata-browser-entry acp-appdata-browser-entry-parent" data-action="browse-appdata-source-parent"' + browserEntryAttr + '>' +
          '<span class="acp-appdata-browser-entry-name">' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesBrowseParentLabel", "...")) + "</span>" +
          '<span class="acp-appdata-browser-entry-path">' + ACP.escapeHtml(String(browser.parentPath || "")) + "</span>" +
        "</div>"
      );
    }

    $.each(entries, function(_, entry) {
      entryHtml.push(
        '<div class="acp-appdata-browser-entry" data-action="browse-appdata-source" data-path="' + ACP.escapeHtml(String((entry && entry.path) || "")) + '"' + browserEntryAttr + '>' +
          '<span class="acp-appdata-browser-entry-name">' + ACP.escapeHtml(String((entry && entry.name) || "")) + "</span>" +
          '<span class="acp-appdata-browser-entry-path">' + ACP.escapeHtml(String((entry && entry.path) || "")) + "</span>" +
        "</div>"
      );
    });
    browserListHtml = browserListHtml.concat(entryHtml);

    html.push(
      "</div>",
      '<div class="acp-modal-panel">',
      '<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesManualTitle", "Manual source paths")) + "</div>",
      manualHtml.length
        ? ('<div class="acp-appdata-source-manual-list">' + manualHtml.join("") + "</div>")
        : ('<div class="acp-utility-empty">' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesManualEmpty", "No manual appdata source paths have been added yet.")) + "</div>"),
      '<div class="acp-appdata-browser-shell">',
      '<div class="acp-appdata-browser-current">',
      '<div class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesCurrentPathLabel", "Current path")) + "</div>",
      '<div class="acp-appdata-browser-current-path"><code class="acp-modal-path">' + ACP.escapeHtml(currentPath) + "</code></div>",
      "</div>",
      trailHtml.length
        ? ('<div class="acp-appdata-browser-trail">' + trailHtml.join("") + "</div>")
        : "",
      '<div class="' + ACP.escapeHtml(pathStatusClass) + '">' + ACP.escapeHtml(pathStatusMessage || ACP.t(strings, "appdataSourcesManualHint", "Select a folder path and add it when you reach the full appdata root.")) + "</div>",
      browserListHtml.length
        ? ('<div class="acp-appdata-browser-list">' + browserListHtml.join("") + "</div>")
        : ('<div class="acp-utility-empty">' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesBrowseEmptyMessage", "No child folders are available under the current path.")) + "</div>"),
      '<div class="acp-appdata-browser-actions">',
      '<button type="button" class="acp-button acp-button-secondary" data-action="add-current-appdata-source"' + ((!canAddCurrentPath || state.busy || browser.loading) ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesAddCurrentLabel", "Add selected path")) + "</button>",
      "</div>",
      '<div class="acp-modal-feedback" data-role="appdata-sources-feedback">' + ACP.escapeHtml(feedbackMessage) + "</div>",
      "</div>",
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

  ACP.buildZfsPathMappingsModalHtml = function(context) {
    var state = context.state || {};
    var strings = context.strings || {};
    var settings = state.settings || {};
    var browser = state.zfsPathMappingBrowser || {};
    var mappings = $.isArray(browser.mappings) ? browser.mappings : ($.isArray(settings.zfsPathMappings) ? settings.zfsPathMappings : []);
    var savedMappings = $.isArray(settings.zfsPathMappings) ? settings.zfsPathMappings : [];
    var suggestions = (state.appdataSources && $.isArray(state.appdataSources.zfsPathMappingSuggestions)) ? state.appdataSources.zfsPathMappingSuggestions : [];
    var draft = $.isPlainObject(browser.draft) ? browser.draft : {};
    var breadcrumbs = $.isArray(browser.breadcrumbs) ? browser.breadcrumbs : [];
    var entries = $.isArray(browser.entries) ? browser.entries : [];
    var currentPath = String(browser.currentPath || browser.root || "/mnt");
    var activeField = String(browser.activeField || "shareRoot") === "datasetRoot" ? "datasetRoot" : "shareRoot";
    var feedbackMessage = String(browser.feedbackMessage || "");
    var disabledAttr = (state.busy || browser.loading) ? ' disabled="disabled"' : "";
    var browserEntryAttr = (state.busy || browser.loading)
      ? ' aria-disabled="true" tabindex="-1"'
      : ' role="button" tabindex="0"';
    var trailHtml = [];
    var mappingHtml = [];
    var suggestionHtml = [];
    var browserListHtml = [];
    var shareRoot = String(draft.shareRoot || "");
    var datasetRoot = String(draft.datasetRoot || "");
    var shareRootLabel = ACP.t(strings, "zfsPathMappingsShareRootLabel", "Unraid share root");
    var datasetRootLabel = ACP.t(strings, "zfsPathMappingsDatasetRootLabel", "ZFS dataset mount root");
    var shareRootDisplay = shareRoot || ACP.t(strings, "notSelectedLabel", "Not selected");
    var datasetRootDisplay = datasetRoot || ACP.t(strings, "notSelectedLabel", "Not selected");
    var draftPartial = (!!shareRoot || !!datasetRoot) && (!shareRoot || !datasetRoot || shareRoot === datasetRoot);
    var draftComplete = !!shareRoot && !!datasetRoot && shareRoot !== datasetRoot;
    var draftKey = shareRoot + "=>" + datasetRoot;
    var draftDuplicate = false;
    var effectiveMappings = [];
    var savedMappingKeys = $.map(savedMappings, function(mapping) {
      return String((mapping && mapping.shareRoot) || "") + "=>" + String((mapping && mapping.datasetRoot) || "");
    });
    var currentMappingKeys = $.map(mappings, function(mapping) {
      return String((mapping && mapping.shareRoot) || "") + "=>" + String((mapping && mapping.datasetRoot) || "");
    });
    var draftStatusMessage = "";
    var draftStatusClass = "acp-modal-hint";
    var canAddMapping = draftComplete;
    var canSaveMappings = false;

    draftDuplicate = $.inArray(draftKey, currentMappingKeys) !== -1;
    if (draftComplete && !draftDuplicate) {
      effectiveMappings = mappings.concat([{
        shareRoot: shareRoot,
        datasetRoot: datasetRoot
      }]);
    } else {
      effectiveMappings = mappings.slice(0);
    }

    if (draftPartial) {
      draftStatusMessage = ACP.t(strings, "zfsPathMappingsDraftPartialMessage", "Finish both roots before saving. ZFS mappings only affect dataset delete resolution, not scan discovery.");
      draftStatusClass += " is-warning";
    } else if (draftComplete && !draftDuplicate) {
      draftStatusMessage = ACP.t(strings, "zfsPathMappingsDraftPendingSaveMessage", "Save mappings will add the current draft automatically. Mappings change ZFS dataset resolution only; they do not change which rows are discovered.");
    } else {
      draftStatusMessage = ACP.t(strings, "zfsPathMappingsResolutionHint", "Mappings change ZFS dataset resolution only. They do not change whether orphan rows are discovered.");
    }

    canSaveMappings = !state.busy &&
      !browser.loading &&
      !draftPartial &&
      JSON.stringify(effectiveMappings) !== JSON.stringify(savedMappings);
    var html = [
      '<div class="acp-modal-summary">',
      '<div class="acp-modal-copy">',
      '<div class="acp-modal-subcopy">' + ACP.escapeHtml(ACP.t(strings, "zfsPathMappingsLead", "Map the Unraid share root to the real dataset mount root so matched orphan rows can resolve exact ZFS datasets safely.")) + "</div>",
      '<div class="acp-modal-hint">' + ACP.escapeHtml(ACP.t(strings, "zfsPathMappingsHint", "Choose the share root first, then the matching dataset mount root. Only exact dataset mountpoint matches become ZFS-backed delete candidates.")) + "</div>",
      "</div>",
      '<div class="acp-modal-actions-row">',
      '<button type="button" class="acp-button acp-button-secondary" data-action="save-zfs-path-mappings"' + ((!canSaveMappings || state.busy || browser.loading) ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(ACP.t(strings, "zfsPathMappingsSaveLabel", "Save mappings")) + "</button>",
      "</div>",
      "</div>",
      '<div class="acp-modal-panel">',
      '<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "zfsPathMappingsExistingTitle", "Configured mappings")) + "</div>"
    ];

    $.each(mappings, function(_, mapping) {
      var share = String((mapping && mapping.shareRoot) || "");
      var dataset = String((mapping && mapping.datasetRoot) || "");

      if (!share || !dataset) {
        return;
      }

      mappingHtml.push(
        '<div class="acp-zfs-mapping-item">' +
          '<div class="acp-zfs-mapping-paths">' +
            '<div class="acp-modal-result-destination">' +
              '<span class="acp-modal-result-label">' + ACP.escapeHtml(shareRootLabel) + '</span>' +
              '<code class="acp-modal-path">' + ACP.escapeHtml(share) + "</code>" +
            "</div>" +
            '<div class="acp-modal-result-destination">' +
              '<span class="acp-modal-result-label">' + ACP.escapeHtml(datasetRootLabel) + '</span>' +
              '<code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(dataset) + "</code>" +
            "</div>" +
          "</div>" +
          '<button type="button" class="acp-button acp-button-secondary" data-action="remove-zfs-path-mapping" data-share-root="' + ACP.escapeHtml(share) + '" data-dataset-root="' + ACP.escapeHtml(dataset) + '"' + disabledAttr + '>' + ACP.escapeHtml(ACP.t(strings, "zfsPathMappingsRemoveLabel", "Remove")) + "</button>" +
        "</div>"
      );
    });

    if (!mappingHtml.length) {
      html.push('<div class="acp-utility-empty">' + ACP.escapeHtml(ACP.t(strings, "zfsPathMappingsEmpty", "No ZFS path mappings have been added yet.")) + "</div>");
    } else {
      html.push('<div class="acp-zfs-mapping-list">' + mappingHtml.join("") + "</div>");
    }

    html.push("</div>");

    $.each(suggestions, function(_, suggestion) {
      var share = String((suggestion && suggestion.shareRoot) || "");
      var dataset = String((suggestion && suggestion.datasetRoot) || "");
      var datasetName = String((suggestion && suggestion.datasetName) || "");
      var suggestionKey = share + "=>" + dataset;

      if (!share || !dataset || $.inArray(suggestionKey, currentMappingKeys) !== -1) {
        return;
      }

      suggestionHtml.push(
        '<div class="acp-zfs-suggestion-item">' +
          '<div class="acp-zfs-mapping-paths">' +
            '<div class="acp-modal-result-destination">' +
              '<span class="acp-modal-result-label">' + ACP.escapeHtml(shareRootLabel) + '</span>' +
              '<code class="acp-modal-path">' + ACP.escapeHtml(share) + "</code>" +
            "</div>" +
            '<div class="acp-modal-result-destination">' +
              '<span class="acp-modal-result-label">' + ACP.escapeHtml(datasetRootLabel) + '</span>' +
              '<code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(dataset) + "</code>" +
            "</div>" +
            (datasetName ? ('<div class="acp-modal-hint">' + ACP.escapeHtml(datasetName) + "</div>") : "") +
          "</div>" +
          '<button type="button" class="acp-button acp-button-secondary" data-action="use-zfs-path-mapping-suggestion" data-share-root="' + ACP.escapeHtml(share) + '" data-dataset-root="' + ACP.escapeHtml(dataset) + '"' + disabledAttr + '>' + ACP.escapeHtml(ACP.t(strings, "zfsPathMappingsSuggestionUseLabel", "Use suggestion")) + "</button>" +
        "</div>"
      );
    });

    if (suggestionHtml.length) {
      html.push(
        '<div class="acp-modal-panel">',
        '<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "zfsPathMappingsSuggestedTitle", "Suggested mappings")) + "</div>",
        '<div class="acp-modal-hint">' + ACP.escapeHtml(ACP.t(strings, "zfsPathMappingsSuggestedHint", "These pairings were inferred from your effective scan roots and detected ZFS mountpoints. Review them before saving.")) + "</div>",
        '<div class="acp-zfs-suggestion-list">' + suggestionHtml.join("") + "</div>",
        "</div>"
      );
    }

    $.each(breadcrumbs, function(_, crumb) {
      trailHtml.push('<span class="acp-appdata-browser-trail-part">' + ACP.escapeHtml(String((crumb && crumb.label) || "")) + "</span>");
    });

    if (browser.parentPath) {
      browserListHtml.push(
        '<div class="acp-appdata-browser-entry acp-appdata-browser-entry-parent" data-action="browse-zfs-mapping-parent"' + browserEntryAttr + '>' +
          '<span class="acp-appdata-browser-entry-name">' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesBrowseParentLabel", "...")) + "</span>" +
          '<span class="acp-appdata-browser-entry-path">' + ACP.escapeHtml(String(browser.parentPath || "")) + "</span>" +
        "</div>"
      );
    }

    $.each(entries, function(_, entry) {
      browserListHtml.push(
        '<div class="acp-appdata-browser-entry" data-action="browse-zfs-mapping-path" data-path="' + ACP.escapeHtml(String((entry && entry.path) || "")) + '"' + browserEntryAttr + '>' +
          '<span class="acp-appdata-browser-entry-name">' + ACP.escapeHtml(String((entry && entry.name) || "")) + "</span>" +
          '<span class="acp-appdata-browser-entry-path">' + ACP.escapeHtml(String((entry && entry.path) || "")) + "</span>" +
        "</div>"
      );
    });

    html.push(
      '<div class="acp-modal-panel">',
      '<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "zfsPathMappingsDraftTitle", "Add mapping")) + "</div>",
      '<div class="acp-zfs-mapping-draft-grid">',
      '<div class="acp-zfs-mapping-field">',
      '<span class="acp-modal-result-label">' + ACP.escapeHtml(shareRootLabel) + "</span>",
      '<code class="acp-modal-path">' + ACP.escapeHtml(shareRootDisplay) + "</code>",
      "</div>",
      '<div class="acp-zfs-mapping-field">',
      '<span class="acp-modal-result-label">' + ACP.escapeHtml(datasetRootLabel) + "</span>",
      '<code class="acp-modal-path acp-modal-path-secondary">' + ACP.escapeHtml(datasetRootDisplay) + "</code>",
      "</div>",
      "</div>",
      '<div class="' + ACP.escapeHtml(draftStatusClass) + '">' + ACP.escapeHtml(draftStatusMessage) + "</div>",
      '<div class="acp-modal-result-destination">',
      '<span class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "zfsPathMappingsCurrentTargetLabel", "Picker target")) + "</span>",
      '<div class="acp-zfs-mapping-target-actions">',
      '<button type="button" class="acp-button ' + (activeField === "shareRoot" ? "acp-button-primary" : "acp-button-secondary") + '" data-action="set-zfs-browser-field" data-field="shareRoot"' + disabledAttr + '>' + ACP.escapeHtml(ACP.t(strings, "zfsPathMappingsBrowseShareLabel", "Browse share root")) + "</button>",
      '<button type="button" class="acp-button ' + (activeField === "datasetRoot" ? "acp-button-primary" : "acp-button-secondary") + '" data-action="set-zfs-browser-field" data-field="datasetRoot"' + disabledAttr + '>' + ACP.escapeHtml(ACP.t(strings, "zfsPathMappingsBrowseDatasetLabel", "Browse ZFS mount root")) + "</button>",
      "</div>",
      "</div>",
      '<div class="acp-appdata-browser-actions">',
      '<button type="button" class="acp-button acp-button-secondary" data-action="use-current-zfs-mapping-path"' + disabledAttr + '>' + ACP.escapeHtml(ACP.t(strings, "zfsPathMappingsUseCurrentLabel", "Use current path")) + "</button>",
      '<button type="button" class="acp-button acp-button-secondary" data-action="clear-zfs-mapping-draft"' + disabledAttr + '>' + ACP.escapeHtml(ACP.t(strings, "zfsPathMappingsClearDraftLabel", "Clear draft")) + "</button>",
      '<button type="button" class="acp-button acp-button-primary" data-action="add-zfs-path-mapping"' + ((!canAddMapping || state.busy || browser.loading) ? ' disabled="disabled"' : "") + '>' + ACP.escapeHtml(ACP.t(strings, "zfsPathMappingsAddLabel", "Add mapping")) + "</button>",
      "</div>",
      "</div>",
      '<div class="acp-modal-panel">',
      '<div class="acp-modal-panel-title">' + ACP.escapeHtml(ACP.t(strings, "zfsPathMappingsBrowserTitle", "Folder picker")) + "</div>",
      '<div class="acp-appdata-browser-shell">',
      '<div class="acp-appdata-browser-current">',
      '<div class="acp-modal-result-label">' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesCurrentPathLabel", "Current path")) + "</div>",
      '<div class="acp-appdata-browser-current-path"><code class="acp-modal-path">' + ACP.escapeHtml(currentPath) + "</code></div>",
      "</div>",
      trailHtml.length ? ('<div class="acp-appdata-browser-trail">' + trailHtml.join("") + "</div>") : "",
      browser.loading
        ? ('<div class="acp-appdata-browser-status is-loading">' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesBrowseLoadingMessage", "Loading folders from the selected path.")) + "</div>")
        : "",
      browserListHtml.length
        ? ('<div class="acp-appdata-browser-list">' + browserListHtml.join("") + "</div>")
        : ('<div class="acp-utility-empty">' + ACP.escapeHtml(ACP.t(strings, "appdataSourcesBrowseEmptyMessage", "No child folders are available under the current path.")) + "</div>"),
      '<div class="acp-modal-feedback" data-role="zfs-path-mappings-feedback">' + ACP.escapeHtml(feedbackMessage) + "</div>",
      "</div>",
      "</div>"
    );

    return html.join("");
  };
})(window, document, jQuery);
