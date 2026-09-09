var CONFIGURATOR_URL = "https://directsamenstellen.nl";
var CMP_URL = "https://consent.directsamenstellen.nl";

var RP_CONFIGURATOR_ID_TAG_NAME = "data-rp-configurator-id";
var RP_CONFIGURATOR_IFRAME_ADDED_TAG_NAME = "data-rp-iframe-added";
var RP_IFRAME_CONFIGURATOR_ID_TAG_NAME = "data-rp-iframe-configurator-id";
var RP_WIDGET_CONFIGURATOR_TAG_NAME = "data-rp-is-widget"
var RP_HAS_BUTTON_TAG_NAME = "data-has-button"
var RP_ID_DATA_TAG_NAME = "data-rp-unique-id";
var RP_CUSTOM_ID_DATA_TAG_NAME = "data-rp-id";
var RP_BUTTON_ID_TAG_NAME = "data-rp-button-id";

var RP_EXTERNAL_EVENT_NAME = "rp-event";

var reuzenpandaMessaging = {};

reuzenpandaMessaging.subscribers = [];

// reuzenpandaMessaging.subscribe = (id, messageType) => {
//   reuzenpandaMessaging.subscribers.push({
//     id: id,
//     messageType: messageType
//   });
// }

reuzenpandaMessaging.publish = (messageType, data) => {
  // console.log("publishing message", messageType, data);

  let iframes = document.querySelectorAll(`[${RP_IFRAME_CONFIGURATOR_ID_TAG_NAME}]`);
  for (const iframe of iframes) {
    if (!iframe || !iframe.contentWindow) {
      continue;
    }

    iframe.contentWindow.postMessage({
      id: "reuzenpanda-reuzenpanda-message",
      messageType: messageType,
      data: data
    }, "*");
  }

  for (var subscriber of reuzenpandaMessaging.subscribers.filter(s => s.messageType === messageType)) {
    const configuratorId = subscriber.id;
    reuzenpandaSnippet.sendPostMessage(configuratorId, messageType, data);
  }
}



// Reuse the existing global instead of replacing it. If the snippet is
// installed/executed more than once on the same page (e.g. two identical
// <script> includes, or a tag-manager/SPA re-injection), a second execution
// would otherwise run `= {}` here and replace window.reuzenpandaSnippet with a
// fresh, empty object. The DOMContentLoaded/init guard below then blocks the
// second run's setup()/load(), so that empty object is never repopulated —
// leaving RP_CONFIGURATORS/RP_BUTTONS empty while the DOM (built by the first
// run) still has the containers/iframes. open()/close() then find no
// configurator to toggle and the widget never opens.
var reuzenpandaSnippet = window.reuzenpandaSnippet || {};
window.reuzenpandaSnippet = reuzenpandaSnippet;
reuzenpandaSnippet.parentUrlParams =
  Object.fromEntries(new URLSearchParams(window.location.search));
reuzenpandaSnippet.RP_CONFIGURATORS = reuzenpandaSnippet.RP_CONFIGURATORS || [];
reuzenpandaSnippet.RP_BUTTONS = reuzenpandaSnippet.RP_BUTTONS || [];

var extraExecutors = [];

if (window.extraExecutors) {
  extraExecutors = window.extraExecutors;
}

reuzenpandaSnippet.RP_MESSAGE_EXECUTORS = [
  ...extraExecutors,
  {
    id: "hide-cmp",
    executor: () => {
      var cmp = document.querySelector('.reuzenpanda-consent-management-platform-advanced') ||
        document.querySelector('.reuzenpanda-consent-management-platform-simplified');
      if (cmp) cmp.classList.add('hidden');
    }
  },
  {
    id: "show-cmp",
    executor: () => {
      var cmp = document.querySelector('.reuzenpanda-consent-management-platform-advanced') ||
        document.querySelector('.reuzenpanda-consent-management-platform-simplified');
      if (cmp) cmp.classList.remove('hidden');
    }
  },
  {
    id: "show-options-dialog-cmp",
    executor: () => {
      var cmp = document.querySelector('.reuzenpanda-consent-management-platform-advanced') ||
        document.querySelector('.reuzenpanda-consent-management-platform-simplified');
      if (cmp) cmp.classList.add('show-options-dialog-cmp');
    }
  },
  {
    id: "close-options-dialog-cmp",
    executor: () => {
      var cmp = document.querySelector('.reuzenpanda-consent-management-platform-advanced') ||
        document.querySelector('.reuzenpanda-consent-management-platform-simplified');
      if (cmp) cmp.classList.remove('show-options-dialog-cmp');
    }
  },
  {
    id: "open",
    executor: (data) => {
      reuzenpandaSnippet.open(data.configuratorId);
    }
  },
  {
    id: "close",
    executor: (data) => {
      reuzenpandaSnippet.close(data.configuratorId);
    }
  },
  {
    id: "gtm-push",
    executor: (data) => {
      // if is array, get first element, if not just use data
      if (data && Array.isArray(data)) {
        data = data[0];
      }
      window.dataLayer?.push(data);
      window.rpDataLayer?.push(data);
    }
  },
  {
    id: "set-widget-open-state",
    executor: (data) => {
      console.log("set state", data);
      if (data.isOpen) {
        reuzenpandaSnippet.open(data.configuratorId);
      } else {
        reuzenpandaSnippet.removeAnchorsFromUrl();
        reuzenpandaSnippet.close(data.configuratorId);
      }

      for (var configurator of reuzenpandaSnippet.filterConfiguratorsByValue(data.configuratorId)) {
        configurator.setOpen(data.isOpen);
      }

      for (var button of reuzenpandaSnippet.filterButtonsByValue(data.configuratorId)) {
        button.setOpen(!data.isOpen);
      }
    }
  },
  {
    id: "route",
    executor: (data) => {
      if (!data.url) {
        return;
      }

      if (!data.url.startsWith("http://") && !data.url.startsWith("https://")) {
        data.url = "https://" + data.url;
      }
      window.location.href = data.url;
    }
  },
  {
    id: "set-cookie-pandavision",
    executor: (data) => {
      if (data && data.createdAt) {
        let containers = document.querySelectorAll(`[${RP_CONFIGURATOR_ID_TAG_NAME}]`);
        for (var container of containers) {
          let iframe = container.querySelector("iframe");
          if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({
              id: "set-cookie-pandavisions",
              messageId: uuidv4(),
              data: {
                messageId: uuidv4(),
                timestamp: data.timestamp,
                analytics: data.analytics ? true : false,
              }
            }, "*");
          }
        }
      }
    }
  },
  {
    id: "reuzenpanda-reuzenpanda-message",
    executor: (data) => {
      if (!data) {
        return;
      }

      reuzenpandaMessaging.publish(data.messageType, data.payload);
    }
  },
];

reuzenpandaSnippet.RP_ANCHOR_EXECUTORS = [
  {
    regex: new RegExp("reuzenpanda-open-all"),
    executor: () => {
      reuzenpandaSnippet.open()
    }
  },
  {
    regex: new RegExp("reuzenpanda-open-(\\w{8}(-\\w{4}){3}-\\w{12}?)"),
    executor: (anchor) => {
      var id = new RegExp("reuzenpanda-open-(\\w{8}(-\\w{4}){3}-\\w{12}?)").exec(anchor)[1];
      reuzenpandaSnippet.open(id)
    }
  }
];

reuzenpandaSnippet.RP_SEARCH_EXECUTORS = [
  {
    regex: new RegExp("reuzenpanda-set-step-position"),
    executor: (stepPosition) => {
      var stepPositionInt = parseInt(stepPosition);
      if (isNaN(stepPositionInt)) {
        return;
      }

      reuzenpandaSnippet.setStepPosition(stepPositionInt);
    }
  }
];


reuzenpandaSnippet.removeAnchorsFromUrl = () => {
  var url = window.location.href;
  var [baseUrl, ...hashParts] = url.split('#');

  var reuzenpandaHashParts = hashParts.filter(part => {
    var matchingExecutors = reuzenpandaSnippet.RP_ANCHOR_EXECUTORS.some(ex => ex.regex.test(part));
    if (matchingExecutors) {
      return true;
    }

    return false;
  });

  if (reuzenpandaHashParts.length === 0) {
    return;
  }

  var newUrl = `${baseUrl}`;
  window.history.replaceState(null, document.title, newUrl);
};

reuzenpandaSnippet.utils = {
  generateConfigurator(id, configuratorId, element, isWidget, hasButton) {
    let iframe = element.querySelector("iframe");
    return {
      id: id,
      configuratorId: configuratorId,
      element: element,
      embedded: !isWidget,
      hasButton: hasButton,
      setOpen: (open) => {
        if (open) {
          if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({
              id: "snippet-widget-open",
              messageId: id,
              data: {
                messageId: id,
                hasButton: hasButton
              }
            }, "*");
          }

          element.classList.add("--visible");
        } else {
          if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({
              id: "snippet-widget-close",
              messageId: id,
              data: {
                messageId: id,
                hasButton: hasButton
              }
            }, "*");
          }

          element.classList.remove("--visible");
        }
      }
    };
  },
  getIframe(id, configuratorId, type, syncId) {
    let iframe = document.createElement("iframe");
    iframe.src = CONFIGURATOR_URL + `/configurator/${configuratorId}/${type}/1?messageId=${id}&&`;

    if (reuzenpandaSnippet.parentUrlParams) {
      const params = [];
      let isEditMode = false;
      Object.entries(reuzenpandaSnippet.parentUrlParams).forEach(([key, value]) => {
        if (key === "editConfiguratorId") {
          iframe.src = CONFIGURATOR_URL + `/configurator/${configuratorId}/${type}/1?messageId=${id}&K=true&editConfiguratorId=${value}`;
          isEditMode = true;
        } else {
          params.push(`${key}=${encodeURIComponent(value)}`);
        }
      });

      if (!isEditMode && params.length > 0) {
        iframe.src += params.join("&");
      }
    }

    if (syncId) {
      iframe.name = "rp-sync-id:" + syncId;
    }

    iframe.setAttribute(RP_IFRAME_CONFIGURATOR_ID_TAG_NAME, configuratorId);
    iframe.setAttribute(RP_ID_DATA_TAG_NAME, id);
    iframe.classList.add("reuzenpanda-iframe");

    iframe.onload = () => {
      reuzenpandaSnippet.sendParentUrlParams(iframe);
      reuzenpandaSnippet.handleSearchParams(window.location.href);
    };
    return iframe;
  }
}

reuzenpandaSnippet.loadConfigurator = (configuratorId) => {
  let containers = document.querySelectorAll(`[${RP_CONFIGURATOR_ID_TAG_NAME}]`);
  for (var container of containers) {
    if (container.getAttribute(RP_CONFIGURATOR_ID_TAG_NAME) !== configuratorId) {
      continue;
    }

    if (container.getAttribute(RP_CONFIGURATOR_IFRAME_ADDED_TAG_NAME) === "yes") {
      console.warn("Most likely the Reuzenpanda snippet is installed twice on the page. Please remove the duplicate snippet.");
      continue;
    }

    var syncId = container.getAttribute("data-rp-sync-id");

    var isWidget = container.getAttribute(RP_WIDGET_CONFIGURATOR_TAG_NAME);
    var hasButton = container.getAttribute(RP_HAS_BUTTON_TAG_NAME);
    let id = uuidv4();
    container.setAttribute(RP_ID_DATA_TAG_NAME, id);
    container.appendChild(reuzenpandaSnippet.utils.getIframe(id, configuratorId, isWidget ? "reuzenpanda-widget" : "reuzenpanda-embedded", syncId));
    let configurator = reuzenpandaSnippet.utils.generateConfigurator(id, configuratorId, container, isWidget, hasButton);
    reuzenpandaSnippet.RP_CONFIGURATORS.push(configurator);

    container.setAttribute(RP_CONFIGURATOR_IFRAME_ADDED_TAG_NAME, "yes");
  }
}

(() => {
  var configurators = [{"id":"28befe23-1200-4d1c-8092-e48a83477820","displaySettings":{"showBranding":false,"showActionButton":false,"disableWidget":false},"advancedSettings":{"automation":true,"configuratorLanguage":"nl","showAnalytics":true,"showCloseButton":false,"showCookieBanner":"NONE"}},{"id":"6fc19f6f-c68b-4660-b15a-89fbb394e83e","displaySettings":{"showBranding":false,"showActionButton":false,"disableWidget":false},"advancedSettings":{"automation":true,"configuratorLanguage":"nl","showAnalytics":true,"showCloseButton":false,"showCookieBanner":"NONE"}}];
  var showActionButtons = true;
  var showWidget = true;

  // Guard against the snippet being installed/executed more than once on the
  // same page (e.g. via a tag manager or SPA re-injection). Without this, a
  // second execution runs setup()/load() again and creates duplicate
  // containers/iframes for the same configurator, which makes the configurator
  // get fetched multiple times.
  if (window.__rpSnippetInitialized) {
    console.warn("Most likely the Reuzenpanda snippet is installed twice on the page. Please remove the duplicate snippet.");
    return;
  }
  window.__rpSnippetInitialized = true;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", async function(event) {
      console.log("rp-dom-loaded")
      setup();
      load();
    });
  } else {
    setup();
    load();
  }


  function setup() {
    (function(w, d, s, l, i) {
      w[l] = w[l] || []
      w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' })
      var f = d.getElementsByTagName(s)[0], j = d.createElement(s),
        dl = l != 'rpDataLayer' ? '&l=' + l : ''
      j.async = true
      j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i + dl

      f.parentNode.insertBefore(j, f)
    })(window, document, 'script', 'rpDataLayer', 'GTM-58DN284')

    configurators.forEach((configurator) => {
      if (showWidget && !configurator.displaySettings?.disableWidget) {
        loadWidgetContainer(configurator.id, configurator.displaySettings?.showActionButton && showActionButtons);
      }

      if ((configurator.displaySettings?.showActionButton && !configurator.displaySettings?.disableWidget) && showActionButtons) {
        loadButtonContainer(configurator.id);
      }

      if (configurator.advancedSettings?.showAnalytics) {
        loadConsentManagementPlatform(configurator);
      }
    });

    loadStyleSheet("https://snippet.reuzenpanda.nl/api/snippet/v1/css");

    window.addEventListener("message", convertMessageToExecutorEvent);
    window.addEventListener(RP_EXTERNAL_EVENT_NAME, handleExecutorEvent);
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('popstate', () => {
      reuzenpandaSnippet.handleSearchParams(window.location.href);
    });
  }

  function load() {
    configurators.forEach((configurator) => {
      reuzenpandaSnippet.loadConfigurator(configurator.id);

      if (configurator.displaySettings?.showActionButton && showActionButtons) {
        loadButton(configurator.id);
      }
    });

    setTimeout(() => {
      handleAnchor(window.location.href);
      reuzenpandaSnippet.handleSearchParams(window.location.href);
    }, 2000);
  }


  function loadWidgetContainer(configuratorId, hasButton) {
    // Skip creating a widget popup only when it would be redundant: there is no
    // action button to open it AND a container for this configurator already
    // exists (e.g. an embedded container placed by the host page, or a widget
    // container from a previous run). In that case a second container would
    // just make loadConfigurator attach an extra iframe and fetch the same
    // configurator twice.
    //
    // When there IS a button, the widget popup is exactly what the button
    // opens, so it must be created even if the host page also embeds the
    // configurator inline — otherwise clicking the button toggles open state
    // but there is no popup container to show.
    if (!hasButton) {
      var existingContainer = document.querySelector(`[${RP_CONFIGURATOR_ID_TAG_NAME}="${configuratorId}"]`);
      if (existingContainer) {
        return;
      }
    }

    let div = document.createElement("div");
    div.setAttribute(RP_CONFIGURATOR_ID_TAG_NAME, configuratorId);
    div.setAttribute(RP_WIDGET_CONFIGURATOR_TAG_NAME, "true");
    div.setAttribute(RP_HAS_BUTTON_TAG_NAME, hasButton ? "true" : "false");
    div.classList.add("reuzenpanda-configurator");
    div.classList.add("reuzenpanda-widget");

    document.body.appendChild(div);
  }

  function loadConsentManagementPlatform(configurator) {
    if(configurator.advancedSettings?.showCookieBanner === "NONE") {
      return;
    }
    let div = document.createElement("div");

    if (configurator.advancedSettings?.showCookieBanner === "ADVANCED") {
      div.classList.add("reuzenpanda-consent-management-platform-advanced");
    } else if (configurator.advancedSettings?.showCookieBanner === "SIMPLIFIED") {
      div.classList.add("reuzenpanda-consent-management-platform-simplified");
    }

    div.classList.add("hidden");

    let iframe = document.createElement("iframe");
    iframe.src = `${CMP_URL}/consent/${configurator.advancedSettings?.showCookieBanner}`;
    iframe.classList.add("reuzenpanda-iframe");
    iframe.allowTransparency = true;

    var style = document.createElement("style");
    style.innerHTML = `.hidden { display: none !important; }`;
    document.head.appendChild(style);

    div.appendChild(iframe);
    document.body.appendChild(div);
  }

  function loadButtonContainer(configuratorId) {
    var existingButton = document.querySelector(`[${RP_BUTTON_ID_TAG_NAME}="${configuratorId}"]`);
    if (existingButton) {
      return;
    }


    let div = document.createElement("div");
    div.classList.add("reuzenpanda-configurator-button");
    div.setAttribute(RP_BUTTON_ID_TAG_NAME, configuratorId);

    document.body.appendChild(div);
  }


  function loadStyleSheet(url) {
    let styleSheet = document.createElement("link");
    styleSheet.rel = "stylesheet";
    styleSheet.type = "text/css"
    styleSheet.href = url;

    document.getElementsByTagName("head")[0].appendChild(styleSheet);
  }

  function loadButton(configuratorId) {
    let containers = document.querySelectorAll(`[${RP_BUTTON_ID_TAG_NAME}]`);

    for (var container of containers) {
      if (container.getAttribute(RP_BUTTON_ID_TAG_NAME) === configuratorId) {
        let id = uuidv4();

        container.setAttribute(RP_ID_DATA_TAG_NAME, id);
        container.appendChild(getButtonIframe(id, configuratorId));
        let button = generateButton(id, configuratorId, container);

        reuzenpandaSnippet.RP_BUTTONS.push(button);
      }
    }


    function generateButton(id, configuratorId, element) {
      return {
        id: id,
        configuratorId: configuratorId,
        element: element,
        setOpen: (open) => {
          if (open) {
            element.classList.remove("--invisible");
          } else {
            element.classList.add("--invisible");
          }
        }
      };
    }

    function getButtonIframe(id, configuratorId) {
      let iframe = document.createElement("iframe");
      iframe.src = CONFIGURATOR_URL + `/configurator/${configuratorId}/button?messageId=${id}`;
      iframe.classList.add("reuzenpanda-iframe");

      return iframe;
    }
  }


  function convertMessageToExecutorEvent(message) {
    if (!message || !message.data) {
      return;
    }

    var configuratorElements = document.querySelectorAll(`[${RP_CONFIGURATOR_ID_TAG_NAME}]`);
    let customId = "";
    for (var c of configuratorElements) {
      if (c.getAttribute(RP_ID_DATA_TAG_NAME) === message.data.messageId) {
        customId = c.getAttribute(RP_CUSTOM_ID_DATA_TAG_NAME);
      }
    }

    var myEvent = new CustomEvent(RP_EXTERNAL_EVENT_NAME, {
      detail: {
        id: message.data.id,
        data: message.data.data,
        messageId: message.data.messageId,
        customId: customId
      }
    });

    window.dispatchEvent(myEvent);
  }

  function handleExecutorEvent(e) {
    var executors = reuzenpandaSnippet.RP_MESSAGE_EXECUTORS.filter((ex) => ex.id === e.detail.id);
    for (var executor of executors) {
      executor.executor(e.detail.data);
    }
  }

  function handleHashChange(e) {
    if (e.newURL === undefined || e.newURL === null) {
      return;
    }

    if (!e.newURL.includes("#")) {
      return;
    }

    handleAnchor(e.newURL);
  }

  function handleAnchor(url) {
    let anchor = url.split("#")[1];
    var executors = reuzenpandaSnippet.RP_ANCHOR_EXECUTORS.filter((ex) => ex.regex.test(anchor));
    for (var executor of executors) {
      executor.executor(anchor);
    }
  }
})();

function uuidv4() {
  return "000000000".replace(/[018]/g, c =>
    (+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16)
  );
}


reuzenpandaSnippet.filterConfiguratorsByValue = (value) => {
  console.log("filtering configurators by value", value, reuzenpandaSnippet.RP_CONFIGURATORS);
  return reuzenpandaSnippet.RP_CONFIGURATORS.filter((c) =>
    c.id === value ||
    c.configuratorId === value ||
    c.name === value ||
    c.customid === value
  ) ?? [];
}

reuzenpandaSnippet.filterButtonsByValue = (value) => {
  return reuzenpandaSnippet.RP_BUTTONS.filter((c) =>
    c.id === value ||
    c.configuratorId === value ||
    c.name === value ||
    c.customid === value
  ) ?? [];
}


reuzenpandaSnippet.open = (key) => {
  for (var configurator of key ? reuzenpandaSnippet.filterConfiguratorsByValue(key) : reuzenpandaSnippet.RP_CONFIGURATORS) {
    if (!configurator) {
      continue;
    }

    configurator.setOpen(true);

    for (var button of reuzenpandaSnippet.filterButtonsByValue(configurator.configuratorId)) {
      button.setOpen(false);
    }
  }
}

reuzenpandaSnippet.close = (key) => {
  console.log("close", reuzenpandaSnippet.filterConfiguratorsByValue(key));
  for (var configurator of key ? reuzenpandaSnippet.filterConfiguratorsByValue(key) : reuzenpandaSnippet.RP_CONFIGURATORS) {
    if (!configurator) {
      continue;
    }

    configurator.setOpen(false);

    for (var button of reuzenpandaSnippet.filterButtonsByValue(configurator.configuratorId)) {
      button.setOpen(true);
    }
  }
}

reuzenpandaSnippet.sendPostMessage = (configuratorId, messageType, data) => {
  let iframes = document.querySelectorAll(`[${RP_IFRAME_CONFIGURATOR_ID_TAG_NAME}]`);

  for (const iframe of iframes) {
    if (iframe.getAttribute(RP_IFRAME_CONFIGURATOR_ID_TAG_NAME) !== configuratorId) {
      continue;
    }

    const id = iframe.getAttribute(RP_ID_DATA_TAG_NAME);
    if (!id) {
      continue;
    }

    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        id: messageType,
        messageId: id,
        data: data
      }, "*");
    }
  }
}

reuzenpandaSnippet.setStepPosition = (stepPosition, configuratorId) => {
  let iframes = document.querySelectorAll(`[${RP_IFRAME_CONFIGURATOR_ID_TAG_NAME}]`);
  
  for (const iframe of iframes) {
    if (configuratorId && iframe.getAttribute(RP_IFRAME_CONFIGURATOR_ID_TAG_NAME) !== configuratorId) {
      continue;
    }

    const id = iframe.getAttribute(RP_ID_DATA_TAG_NAME);
    if (!id) {
      continue;
    }

    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        id: "set-step-position",
        messageId: id,
        data: {
          stepPosition: stepPosition
        }
      }, "*");
    }
  }
}

reuzenpandaSnippet.sendParentUrlParams = (iframe) => {
  if (!iframe || !iframe.contentWindow) return;

  const params = Object.fromEntries(
    new URLSearchParams(window.location.search)
  );


  iframe.contentWindow.postMessage(
    {
      id: "parent-url-params",
      messageId: iframe.getAttribute(RP_ID_DATA_TAG_NAME),
      data: {
        params
      }
    },
    "*"
  );
};

reuzenpandaSnippet.handleSearchParams = (url) => {
  var searchParams = new URL(url)?.searchParams;
  if (!searchParams) {
    return;
  }

  for (var [key, value] of searchParams.entries()) {
    var executors = reuzenpandaSnippet.RP_SEARCH_EXECUTORS.filter((ex) => ex.regex.test(key));
    if (!executors || executors.length === 0) {
      continue;
    }

    for (var executor of executors) {
      executor.executor(value);
    }
  }
}


window.addEventListener("popstate", () => {
  document
    .querySelectorAll("iframe.reuzenpanda-iframe")
    .forEach((iframe) => {
      reuzenpandaSnippet.sendParentUrlParams(iframe);
      reuzenpandaSnippet.handleSearchParams(window.location.href);
    });
});
