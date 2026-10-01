/**
 * Optional, self-hosted homepage video. The native cover owns its background image,
 * filter, content and spacing. Native saas~19.4's video picker accepts third-party
 * providers, not an MP4 URL; this small layer therefore creates its video only in
 * a public document. No player, source, controls or playback state enters a saved
 * Website Builder region.
 */
(function () {
    "use strict";

    var controllers = new Map();
    var revealObserver = null;
    var revealTargets = [];
    var motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

    function isEditing() {
        return document.documentElement.hasAttribute("data-editable")
            || document.documentElement.hasAttribute("data-edit_translations")
            || document.body.classList.contains("editor_enable");
    }

    function enabled() {
        return document.body.classList.contains("o_prefab_site")
            && document.body.classList.contains("o_prefab_motion_enabled")
            && !isEditing();
    }

    function thinConnection() {
        return !!connection && (connection.saveData
            || ["slow-2g", "2g", "3g"].indexOf(connection.effectiveType) !== -1);
    }

    function clearReveals() {
        if (revealObserver) {
            revealObserver.disconnect();
            revealObserver = null;
        }
        revealTargets.forEach(function (target) { target.classList.remove("o_prefab_home_in_view"); });
        revealTargets = [];
    }

    function revealCards() {
        if (motion.matches) {
            clearReveals();
            return;
        }
        if (revealObserver || !window.IntersectionObserver) {
            return;
        }
        // Nothing is initially hidden. If this enhancement or its stylesheet never
        // loads, every card and step is still visible and usable on first paint.
        revealTargets = Array.from(document.querySelectorAll(
            ".o_prefab_home_products .s_card, .o_prefab_home_process .s_process_step"
        ));
        revealObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting && enabled() && !motion.matches) {
                    entry.target.classList.add("o_prefab_home_in_view");
                    revealObserver.unobserve(entry.target);
                }
            });
        }, {threshold: 0.12});
        revealTargets.forEach(function (target) { revealObserver.observe(target); });
    }

    function createPlayer(hero, index) {
        var layer = hero.querySelector(".o_prefab_home_video_layer");
        var controls = hero.querySelector(".o_prefab_home_video_controls");
        var source;
        try {
            source = new URL(hero.getAttribute("data-prefab-home-video"), window.location.href);
        } catch (_error) {
            return null;
        }
        if (!layer || !controls || source.origin !== window.location.origin
            || !/^https?:$/.test(source.protocol) || !enabled()) {
            return null;
        }

        var destroyed = false;
        var userChoice = null;
        var autoReady = false;
        var autoRejected = false;
        var pending = false;
        var generation = 0;
        var idleHandle;
        var idleIsTimeout = false;
        var rect = hero.getBoundingClientRect();
        var inView = rect.bottom > 0 && rect.top < window.innerHeight;
        var video = document.createElement("video");
        video.id = "prefab-home-background-video-" + index;
        video.className = "o_prefab_home_background_video";
        video.setAttribute("aria-hidden", "true");
        video.setAttribute("tabindex", "-1");
        video.setAttribute("playsinline", "");
        video.setAttribute("muted", "");
        video.preload = "none";
        video.loop = true;
        video.muted = true;
        video.playsInline = true;

        var button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn-outline-secondary o_prefab_home_video_toggle";
        button.setAttribute("aria-controls", video.id);
        button.setAttribute("aria-pressed", "false");
        button.textContent = "Video afspelen";
        layer.appendChild(video);
        controls.appendChild(button);

        function canAutoplay() {
            // Width is deliberately absent: normal mobile connections receive the
            // same live background. Reduced motion/data saving keep the poster.
            return autoReady && !autoRejected && !motion.matches && !thinConnection();
        }

        function wantsPlayback() {
            return userChoice === "playing" || (userChoice !== "paused" && canAutoplay());
        }

        function canPlayNow() {
            return !destroyed && enabled() && !document.hidden && inView && wantsPlayback();
        }

        function updateControl() {
            var playing = !video.paused && !video.ended;
            button.textContent = playing ? "Video pauzeren" : "Video afspelen";
            button.setAttribute("aria-pressed", playing ? "true" : "false");
            hero.classList.toggle("o_prefab_home_video_playing", playing);
        }

        function pause() {
            generation += 1;
            pending = false;
            video.pause();
            updateControl();
        }

        function reconcilePlayback() {
            if (!canPlayNow()) {
                pause();
                return;
            }
            if (pending || !video.paused) {
                return;
            }
            if (!video.hasAttribute("src")) {
                // The public document is checked again immediately before assigning
                // a source. An editor mounted since DOMContentLoaded stays clean.
                if (!enabled()) {
                    return;
                }
                video.src = source.href;
                video.load();
            }
            pending = true;
            var attempt = ++generation;
            var result;
            try {
                result = video.play();
            } catch (error) {
                result = Promise.reject(error);
            }
            Promise.resolve(result).then(function () {
                if (destroyed || attempt !== generation) {
                    return;
                }
                pending = false;
                if (!canPlayNow()) {
                    pause();
                } else {
                    updateControl();
                }
            }).catch(function (error) {
                if (destroyed || attempt !== generation) {
                    return;
                }
                pending = false;
                if (error && error.name === "AbortError") {
                    updateControl();
                    return;
                }
                // Autoplay denial is a poster/manual-play state, not a dead pause
                // control or an automatic retry loop. A deliberate click can retry.
                autoRejected = true;
                userChoice = "paused";
                video.pause();
                hero.classList.remove("o_prefab_home_video_ready");
                updateControl();
            });
        }

        function onPlaying() {
            if (!canPlayNow()) {
                pause();
                return;
            }
            hero.classList.add("o_prefab_home_video_ready");
            updateControl();
        }

        function onError() {
            autoRejected = true;
            userChoice = "paused";
            pause();
            hero.classList.remove("o_prefab_home_video_ready");
        }

        function onClick() {
            if (!enabled() || destroyed) {
                return;
            }
            if (pending || !video.paused) {
                userChoice = "paused";
                pause();
            } else {
                userChoice = "playing";
                // An explicit play is allowed under reduced motion/data saving;
                // neither preference is permission for automatic downloading.
                if (video.error) {
                    video.removeAttribute("src");
                    video.load();
                }
                reconcilePlayback();
            }
        }

        function afterFirstPaint() {
            var begin = function () {
                if (!destroyed && enabled()) {
                    autoReady = true;
                    reconcilePlayback();
                }
            };
            if (window.requestIdleCallback) {
                idleHandle = window.requestIdleCallback(begin, {timeout: 1500});
            } else {
                idleIsTimeout = true;
                idleHandle = window.setTimeout(begin, 100);
            }
        }

        video.addEventListener("playing", onPlaying);
        video.addEventListener("pause", updateControl);
        video.addEventListener("error", onError);
        button.addEventListener("click", onClick);
        document.addEventListener("visibilitychange", reconcilePlayback);
        window.addEventListener("pagehide", pause);
        window.addEventListener("pageshow", reconcilePlayback);
        motion.addEventListener("change", reconcilePlayback);
        if (connection && connection.addEventListener) {
            connection.addEventListener("change", reconcilePlayback);
        }
        var observer = window.IntersectionObserver ? new IntersectionObserver(function (entries) {
            inView = entries[0].isIntersecting && entries[0].intersectionRatio > 0.05;
            reconcilePlayback();
        }, {threshold: [0, 0.05, 0.15]}) : null;
        if (observer) {
            observer.observe(hero);
        }
        if (document.readyState === "complete") {
            afterFirstPaint();
        } else {
            window.addEventListener("load", afterFirstPaint, {once: true});
        }

        return {
            destroy: function () {
                destroyed = true;
                generation += 1;
                video.pause();
                if (observer) {
                    observer.disconnect();
                }
                document.removeEventListener("visibilitychange", reconcilePlayback);
                window.removeEventListener("pagehide", pause);
                window.removeEventListener("pageshow", reconcilePlayback);
                window.removeEventListener("load", afterFirstPaint);
                motion.removeEventListener("change", reconcilePlayback);
                if (connection && connection.removeEventListener) {
                    connection.removeEventListener("change", reconcilePlayback);
                }
                if (idleHandle !== undefined) {
                    if (idleIsTimeout) {
                        window.clearTimeout(idleHandle);
                    } else if (window.cancelIdleCallback) {
                        window.cancelIdleCallback(idleHandle);
                    }
                }
                video.removeEventListener("playing", onPlaying);
                video.removeEventListener("pause", updateControl);
                video.removeEventListener("error", onError);
                button.removeEventListener("click", onClick);
                video.removeAttribute("src");
                video.load();
                video.remove();
                button.remove();
                hero.classList.remove("o_prefab_home_video_ready", "o_prefab_home_video_playing");
            },
        };
    }

    function sync() {
        if (!enabled()) {
            controllers.forEach(function (controller) { controller.destroy(); });
            controllers.clear();
            clearReveals();
            return;
        }
        revealCards();
        document.querySelectorAll("body.o_prefab_site [data-prefab-home-video]").forEach(function (hero, index) {
            if (!controllers.has(hero)) {
                var controller = createPlayer(hero, index);
                if (controller) {
                    controllers.set(hero, controller);
                }
            }
        });
    }

    function start() {
        sync();
        // The server's data-editable guard covers editor entry. The observer also
        // removes runtime nodes if a public document becomes editable in place.
        var observer = new MutationObserver(sync);
        observer.observe(document.documentElement, {attributes: true, attributeFilter: ["data-editable", "data-edit_translations"]});
        observer.observe(document.body, {attributes: true, attributeFilter: ["class"]});
        motion.addEventListener("change", sync);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, {once: true});
    } else {
        start();
    }
}());
