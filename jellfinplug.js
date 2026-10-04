(function () {
    'use strict';

    if (window.lampa_jellyfin_source_v2) return;
    window.lampa_jellyfin_source_v2 = true;

    var VERSION = '2.0.0';

    var STORAGE = 'jellyfin_source_config_v2';

    var DEFAULTS = {
        server: '',
        username: '',
        password: '',
        token: '',
        userId: '',
        userName: '',
        serverName: '',
        rememberPassword: true,
        libraries: [],
        autoplay: true,
        syncProgress: true
    };

    var config = loadConfig();

    var currentPlayback = null;
    var progressTimer = null;
    var progressStarted = false;


    /* ============================================================
     * CONFIG
     * ============================================================ */

    function loadConfig() {
        var result = {};

        try {
            result = JSON.parse(
                Lampa.Storage.get(STORAGE, '{}')
            );
        } catch (e) {
            result = {};
        }

        Object.keys(DEFAULTS).forEach(function (key) {
            if (result[key] === undefined) {
                result[key] = DEFAULTS[key];
            }
        });

        return result;
    }

    function saveConfig() {
        Lampa.Storage.set(
            STORAGE,
            JSON.stringify(config)
        );
    }

    function resetConfig() {
        config = JSON.parse(
            JSON.stringify(DEFAULTS)
        );

        saveConfig();
    }


    /* ============================================================
     * HELPERS
     * ============================================================ */

    function serverUrl() {
        return String(config.server || '')
            .replace(/\/+$/, '');
    }

    function encode(value) {
        return encodeURIComponent(
            value === undefined || value === null
                ? ''
                : value
        );
    }

    function notify(text) {

        if (Lampa.Noty && Lampa.Noty.show) {
            Lampa.Noty.show(text);
            return;
        }

        if (Lampa.Notifier && Lampa.Notifier.show) {
            Lampa.Notifier.show(text);
        }
    }

    function loading(show) {

        if (show) {
            if (Lampa.Loading && Lampa.Loading.start) {
                Lampa.Loading.start();
            }
        } else {
            if (Lampa.Loading && Lampa.Loading.stop) {
                Lampa.Loading.stop();
            }
        }
    }

    function json(data) {

        if (typeof data === 'object') {
            return data;
        }

        try {
            return JSON.parse(data);
        } catch (e) {
            return null;
        }
    }

    function api(path, query) {

        var url = serverUrl() + path;

        var params = [];

        if (config.token) {
            params.push(
                'api_key=' + encode(config.token)
            );
        }

        if (query) {

            Object.keys(query).forEach(function (key) {

                if (
                    query[key] !== undefined &&
                    query[key] !== null &&
                    query[key] !== ''
                ) {
                    params.push(
                        encode(key) +
                        '=' +
                        encode(query[key])
                    );
                }

            });

        }

        if (params.length) {
            url += '?' + params.join('&');
        }

        return url;
    }


    /* ============================================================
     * NETWORK
     * ============================================================ */

    function request(options, success, error) {

        var network = new Lampa.Reguest();

        network.timeout(
            options.timeout || 20000
        );

        var headers = options.headers || {};

        headers.Accept = 'application/json';

        network.silent(
            options.url,
            function (response) {

                var result = json(response);

                success(
                    result !== null
                        ? result
                        : response
                );

            },
            function (a, b) {

                if (error) {
                    error(a, b);
                }

            },
            options.post || false,
            {
                dataType: options.dataType || 'text',
                headers: headers
            }
        );

        return network;
    }


    function get(path, query, success, error) {

        return request(
            {
                url: api(path, query),
                timeout: 20000
            },
            success,
            error
        );
    }


    function post(path, body, success, error) {

        var headers = {
            'Content-Type': 'application/json'
        };

        return request(
            {
                url: api(path),
                post: JSON.stringify(body || {}),
                headers: headers,
                timeout: 30000
            },
            success,
            error
        );
    }


    /* ============================================================
     * AUTH
     * ============================================================ */

    function authenticate(username, password, success, error) {

        var url =
            serverUrl() +
            '/Users/AuthenticateByName';

        var network = new Lampa.Reguest();

        network.timeout(30000);

        network.silent(
            url,
            function (response) {

                var data = json(response);

                if (
                    !data ||
                    !data.AccessToken ||
                    !data.User
                ) {
                    if (error) {
                        error(
                            'Jellyfin не принял логин или пароль'
                        );
                    }

                    return;
                }

                config.token =
                    data.AccessToken;

                config.userId =
                    data.User.Id;

                config.userName =
                    data.User.Name || username;

                if (!config.rememberPassword) {
                    config.password = '';
                } else {
                    config.password = password;
                }

                saveConfig();

                if (success) {
                    success(data);
                }

            },
            function (a) {

                if (error) {
                    error(
                        typeof a === 'string'
                            ? a
                            : 'Ошибка подключения к Jellyfin'
                    );
                }

            },
            JSON.stringify({
                Username: username,
                Pw: password
            }),
            {
                dataType: 'text',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Emby-Authorization':
                        buildAuthorizationHeader()
                }
            }
        );
    }


    function buildAuthorizationHeader() {

        return (
            'MediaBrowser ' +
            'Client="Lampa Jellyfin",' +
            'Device="Lampa",' +
            'DeviceId="lampa-jellyfin",' +
            'Version="' +
            VERSION +
            '"'
        );
    }


    function logout() {

        config.token = '';
        config.userId = '';
        config.userName = '';

        saveConfig();

        notify('Вы вышли из Jellyfin');
    }


    function isAuthorized() {

        return !!(
            config.server &&
            config.token &&
            config.userId
        );
    }


    /* ============================================================
     * IMAGES
     * ============================================================ */

    function imageUrl(item, type) {

        if (!item || !item.Id) {
            return '';
        }

        return api(
            '/Items/' +
            encode(item.Id) +
            '/Images/' +
            (type || 'Primary')
        );
    }


    /* ============================================================
     * ITEM CONVERTER
     * ============================================================ */

    function normalize(item) {

        var isSeries =
            item.Type === 'Series';

        var isMovie =
            item.Type === 'Movie';

        var poster =
            imageUrl(item, 'Primary');

        var backdrop =
            imageUrl(item, 'Backdrop');

        var result = {

            id: item.Id,

            jellyfin_id: item.Id,

            title:
                item.Name ||
                item.OriginalTitle ||
                '',

            name:
                item.Name ||
                '',

            original_title:
                item.OriginalTitle ||
                item.Name ||
                '',

            original_name:
                item.OriginalTitle ||
                item.Name ||
                '',

            overview:
                item.Overview ||
                '',

            description:
                item.Overview ||
                '',

            year:
                item.ProductionYear ||
                '',

            release_date:
                item.PremiereDate
                    ? item.PremiereDate.substring(0, 10)
                    : '',

            first_air_date:
                item.PremiereDate
                    ? item.PremiereDate.substring(0, 10)
                    : '',

            poster_path: poster,

            backdrop_path: backdrop,

            img: poster,

            poster: poster,

            backdrop: backdrop,

            vote_average:
                item.CommunityRating ||
                0,

            number_of_seasons:
                item.ChildCount ||
                0,

            jellyfin_type:
                item.Type,

            is_jellyfin: true,

            jellyfin_item: item
        };

        if (isMovie) {
            result.media_type = 'movie';
        }

        if (isSeries) {
            result.media_type = 'tv';
        }

        return result;
    }


    /* ============================================================
     * LIBRARIES
     * ============================================================ */

    function getLibraries(success, error) {

        get(
            '/Users/' +
            encode(config.userId) +
            '/Views',
            {},
            function (data) {

                if (!data || !data.Items) {

                    if (error) {
                        error(
                            'Jellyfin не вернул библиотеки'
                        );
                    }

                    return;
                }

                success(data.Items);

            },
            error
        );
    }


    function getItems(options, success, error) {

        var query = {

            ParentId:
                options.parentId || undefined,

            SearchTerm:
                options.search || undefined,

            IncludeItemTypes:
                options.types ||
                'Movie,Series',

            Recursive:
                options.recursive !== false,

            SortBy:
                options.sortBy ||
                'SortName',

            SortOrder:
                options.sortOrder ||
                'Ascending',

            StartIndex:
                options.startIndex || 0,

            Limit:
                options.limit || 100,

            Fields:
                'Overview,PrimaryImageAspectRatio,' +
                'CommunityRating,ProductionYear,' +
                'PremiereDate,UserData,' +
                'MediaSources'
        };

        get(
            '/Users/' +
            encode(config.userId) +
            '/Items',
            query,
            success,
            error
        );
    }


    /* ============================================================
     * CONTINUE WATCHING
     * ============================================================ */

    function getResume(success, error) {

        get(
            '/Users/' +
            encode(config.userId) +
            '/Items/Resume',
            {
                Limit: 30,

                Fields:
                    'Overview,' +
                    'PrimaryImageAspectRatio,' +
                    'CommunityRating,' +
                    'ProductionYear,' +
                    'PremiereDate,' +
                    'UserData'
            },
            success,
            error
        );
    }


    /* ============================================================
     * SEARCH
     * ============================================================ */

    function search(query, success, error) {

        getItems(
            {
                search: query,
                types: 'Movie,Series',
                recursive: true,
                limit: 50
            },
            success,
            error
        );
    }


    /* ============================================================
     * SEASONS
     * ============================================================ */

    function getSeasons(seriesId, success, error) {

        get(
            '/Shows/' +
            encode(seriesId) +
            '/Seasons',
            {
                UserId:
                    config.userId,

                Fields:
                    'Overview,PrimaryImageAspectRatio,' +
                    'UserData',

                SortBy:
                    'IndexNumber',

                SortOrder:
                    'Ascending'
            },
            success,
            error
        );
    }


    /* ============================================================
     * EPISODES
     * ============================================================ */

    function getEpisodes(seriesId, seasonId, success, error) {

        get(
            '/Shows/' +
            encode(seriesId) +
            '/Episodes',
            {
                SeasonId:
                    seasonId,

                UserId:
                    config.userId,

                Fields:
                    'Overview,' +
                    'PrimaryImageAspectRatio,' +
                    'UserData,' +
                    'MediaSources',

                SortBy:
                    'IndexNumber',

                SortOrder:
                    'Ascending'
            },
            success,
            error
        );
    }


    /* ============================================================
     * PLAYBACK INFO
     * ============================================================ */

    function getPlaybackInfo(item, success, error) {

        var startTicks = 0;

        if (
            item &&
            item.UserData &&
            item.UserData.PlaybackPositionTicks
        ) {
            startTicks =
                item.UserData.PlaybackPositionTicks;
        }

        post(
            '/Items/' +
            encode(item.Id) +
            '/PlaybackInfo',
            {
                UserId:
                    config.userId,

                StartTimeTicks:
                    startTicks,

                IsPlayback:
                    true,

                AutoOpenLiveStream:
                    true,

                MaxStreamingBitrate:
                    140000000,

                MaxStaticBitrate:
                    140000000,

                DeviceProfile: {

                    Name:
                        'Lampa',

                    MaxStreamingBitrate:
                        140000000,

                    MaxStaticBitrate:
                        140000000,

                    DirectPlayProfiles: [

                        {
                            Container:
                                'mp4,mkv,webm,ts,m2ts',
                            Type:
                                'Video',
                            VideoCodec:
                                'h264,hevc,vp9,av1',
                            AudioCodec:
                                'aac,ac3,eac3,mp3,opus,vorbis,flac',
                            MaxAudioChannels:
                                '8'
                        },

                        {
                            Container:
                                'mp4,mkv,webm',
                            Type:
                                'Video',
                            VideoCodec:
                                'h264,hevc',
                            AudioCodec:
                                'aac,ac3,eac3,mp3'
                        }

                    ],

                    TranscodingProfiles: [

                        {
                            Container:
                                'ts',
                            Type:
                                'Video',
                            VideoCodec:
                                'h264',
                            AudioCodec:
                                'aac,ac3,eac3',
                            Protocol:
                                'hls',
                            MaxAudioChannels:
                                '6'
                        },

                        {
                            Container:
                                'mp4',
                            Type:
                                'Video',
                            VideoCodec:
                                'h264',
                            AudioCodec:
                                'aac',
                            Protocol:
                                'http',
                            MaxAudioChannels:
                                '6'
                        }

                    ],

                    SubtitleProfiles: [

                        {
                            Format:
                                'vtt',
                            Method:
                                'External'
                        },

                        {
                            Format:
                                'srt',
                            Method:
                                'External'
                        },

                        {
                            Format:
                                'ass',
                            Method:
                                'External'
                        },

                        {
                            Format:
                                'ssa',
                            Method:
                                'External'
                        }
                    ]
                }
            },
            function (data) {

                if (
                    !data ||
                    !data.MediaSources ||
                    !data.MediaSources.length
                ) {
                    if (error) {
                        error(
                            'Jellyfin не нашёл источник видео'
                        );
                    }

                    return;
                }

                success(data);

            },
            error
        );
    }


    /* ============================================================
     * STREAM URL
     * ============================================================ */

    function resolveStream(data, item) {

        var source =
            data.MediaSources &&
            data.MediaSources[0];

        if (!source) {
            return null;
        }

        var url = '';

        /*
         * Jellyfin сам может вернуть URL
         * для transcoding.
         */
        if (
            source.SupportsTranscoding &&
            source.TranscodingUrl
        ) {

            url =
                serverUrl() +
                source.TranscodingUrl;

        }

        /*
         * Direct Stream / Direct Play.
         */
        if (
            !url &&
            source.DirectStreamUrl
        ) {

            url =
                serverUrl() +
                source.DirectStreamUrl;

        }

        if (
            !url &&
            source.DirectPlayUrl
        ) {

            url =
                serverUrl() +
                source.DirectPlayUrl;

        }

        /*
         * Fallback.
         */
        if (!url) {

            url =
                serverUrl() +
                '/Videos/' +
                encode(item.Id) +
                '/' +
                encode(source.Id) +
                '/stream' +
                '?static=true';

        }

        /*
         * Если Jellyfin вернул URL без API key,
         * добавляем его.
         */
        if (
            config.token &&
            url.indexOf('api_key=') === -1
        ) {

            url +=
                (url.indexOf('?') >= 0
                    ? '&'
                    : '?') +
                'api_key=' +
                encode(config.token);

        }

        return {
            url: url,
            source: source
        };
    }


    /* ============================================================
     * SUBTITLES
     * ============================================================ */

    function buildSubtitles(data, item) {

        var result = [];

        if (
            !data ||
            !data.MediaSources ||
            !data.MediaSources.length
        ) {
            return result;
        }

        var source =
            data.MediaSources[0];

        var streams =
            source.MediaStreams || [];

        streams.forEach(function (stream) {

            if (
                stream.Type !== 'Subtitle'
            ) {
                return;
            }

            var index =
                stream.Index;

            var format =
                stream.Codec ||
                'vtt';

            var url =
                serverUrl() +
                '/Videos/' +
                encode(item.Id) +
                '/' +
                encode(source.Id) +
                '/Subtitles/' +
                encode(index) +
                '/Stream.' +
                encode(format) +
                '?api_key=' +
                encode(config.token);

            result.push({

                url: url,

                label:
                    stream.DisplayTitle ||
                    stream.Language ||
                    ('Subtitle ' + index),

                language:
                    stream.Language ||
                    '',

                default:
                    !!stream.IsDefault

            });

        });

        return result;
    }


    /* ============================================================
     * PLAYBACK REPORTING
     * ============================================================ */

    function ticksFromSeconds(seconds) {

        return Math.floor(
            Number(seconds || 0) *
            10000000
        );
    }


    function secondsFromTicks(ticks) {

        return Number(ticks || 0) /
            10000000;
    }


    function reportStart(item, position) {

        if (!config.syncProgress) {
            return;
        }

        post(
            '/Sessions/Playing',
            {
                ItemId:
                    item.Id,

                UserId:
                    config.userId,

                PositionTicks:
                    ticksFromSeconds(position),

                CanSeek:
                    true,

                IsPaused:
                    false,

                PlayMethod:
                    'DirectPlay',

                PlaySessionId:
                    currentPlayback
                        ? currentPlayback.playSessionId
                        : undefined
            },
            function () {},
            function () {}
        );
    }


    function reportProgress(item, position, paused) {

        if (!config.syncProgress) {
            return;
        }

        post(
            '/Sessions/Playing/Progress',
            {
                ItemId:
                    item.Id,

                UserId:
                    config.userId,

                PositionTicks:
                    ticksFromSeconds(position),

                IsPaused:
                    !!paused,

                PlayMethod:
                    'DirectPlay',

                PlaySessionId:
                    currentPlayback
                        ? currentPlayback.playSessionId
                        : undefined
            },
            function () {},
            function () {}
        );
    }


    function reportStopped(item, position) {

        if (!config.syncProgress) {
            return;
        }

        post(
            '/Sessions/Playing/Stopped',
            {
                ItemId:
                    item.Id,

                UserId:
                    config.userId,

                PositionTicks:
                    ticksFromSeconds(position),

                PlaySessionId:
                    currentPlayback
                        ? currentPlayback.playSessionId
                        : undefined
            },
            function () {},
            function () {}
        );
    }


    function findVideoElement() {

        var videos =
            document.querySelectorAll(
                'video'
            );

        if (!videos.length) {
            return null;
        }

        return videos[videos.length - 1];
    }


    function stopProgressTracking() {

        if (progressTimer) {
            clearInterval(progressTimer);
            progressTimer = null;
        }

        progressStarted = false;
    }


    function startProgressTracking(item, initialPosition) {

        stopProgressTracking();

        if (!config.syncProgress) {
            return;
        }

        currentPlayback = {
            item: item,
            initialPosition:
                initialPosition || 0,
            playSessionId:
                'lampa-' +
                Date.now() +
                '-' +
                Math.floor(
                    Math.random() * 100000
                )
        };

        var started = false;

        progressTimer =
            setInterval(function () {

                var video =
                    findVideoElement();

                if (!video) {
                    return;
                }

                var position =
                    Number(video.currentTime || 0);

                var paused =
                    !!video.paused;

                if (!started) {

                    started = true;

                    reportStart(
                        item,
                        position
                    );

                } else {

                    reportProgress(
                        item,
                        position,
                        paused
                    );

                }

            }, 10000);
    }


    /* ============================================================
     * PLAY
     * ============================================================ */

    function playItem(item) {

        loading(true);

        getPlaybackInfo(
            item,
            function (data) {

                loading(false);

                var stream =
                    resolveStream(
                        data,
                        item
                    );

                if (!stream || !stream.url) {

                    notify(
                        'Не удалось получить поток Jellyfin'
                    );

                    return;
                }

                var position =
                    item.UserData &&
                    item.UserData.PlaybackPositionTicks
                        ? secondsFromTicks(
                            item.UserData.PlaybackPositionTicks
                        )
                        : 0;

                var subtitles =
                    buildSubtitles(
                        data,
                        item
                    );

                var element = {

                    url:
                        stream.url,

                    title:
                        item.Name || '',

                    thumbnail:
                        imageUrl(
                            item,
                            'Primary'
                        ),

                    quality:
                        'auto',

                    start:
                        position,

                    time:
                        position,

                    subtitles:
                        subtitles,

                    jellyfin:
                        true,

                    jellyfin_id:
                        item.Id,

                    season:
                        item.ParentIndexNumber,

                    episode:
                        item.IndexNumber,

                    jellyfin_item:
                        item
                };

                /*
                 * Передаём позицию в стандартные
                 * поля Lampa.
                 */
                element.timeline =
                    position;

                currentPlayback = {
                    item: item,
                    position: position,
                    playSessionId:
                        'lampa-' +
                        Date.now()
                };

                Lampa.Player.play(
                    element
                );

                if (
                    Lampa.Player.playlist
                ) {
                    Lampa.Player.playlist(
                        [element]
                    );
                }

                startProgressTracking(
                    item,
                    position
                );

            },
            function (err) {

                loading(false);

                notify(
                    typeof err === 'string'
                        ? err
                        : 'Ошибка PlaybackInfo'
                );
            }
        );
    }


    /* ============================================================
     * FULL PAGE BUTTON
     * ============================================================ */

    function addFullButton() {

        Lampa.Listener.follow(
            'full',
            function (event) {

                if (
                    event.type !==
                    'complite'
                ) {
                    return;
                }

                if (
                    !event.data ||
                    !event.data.movie
                ) {
                    return;
                }

                if (!isAuthorized()) {
                    return;
                }

                var root =
                    event.object.activity.render();

                var container =
                    root.find(
                        '.full-start-new__buttons'
                    );

                if (!container.length) {
                    container =
                        root.find(
                            '.full-start__buttons'
                        );
                }

                if (!container.length) {
                    return;
                }

                if (
                    container.find(
                        '.jellyfin-full-button'
                    ).length
                ) {
                    return;
                }

                var movie =
                    event.data.movie;

                var button = $(
                    '<div class="' +
                    'full-start__button ' +
                    'selector ' +
                    'jellyfin-full-button">' +

                    '<svg class="button__icon" ' +
                    'width="22" height="22" ' +
                    'viewBox="0 0 24 24">' +

                    '<path fill="currentColor" d="' +
                    'M4 4h16v16H4zM7 7v10h2V7H7zm4 0v10h2V7h-2zm4 0v10h2V7h-2z' +
                    '"/>' +

                    '</svg>' +

                    '<span>Jellyfin</span>' +

                    '</div>'
                );

                button.on(
                    'hover:enter',
                    function () {

                        var title =
                            movie.title ||
                            movie.name ||
                            '';

                        search(
                            title,
                            function (data) {

                                var items =
                                    data.Items ||
                                    [];

                                if (!items.length) {

                                    notify(
                                        'В Jellyfin ничего не найдено'
                                    );

                                    return;
                                }

                                var item =
                                    chooseBestMatch(
                                        movie,
                                        items
                                    );

                                if (item) {
                                    playItem(item);
                                }

                            },
                            function () {

                                notify(
                                    'Ошибка поиска в Jellyfin'
                                );

                            }
                        );

                    }
                );

                container.prepend(
                    button
                );
            }
        );
    }


    function chooseBestMatch(movie, items) {

        var title =
            String(
                movie.title ||
                movie.name ||
                ''
            ).toLowerCase();

        var original =
            String(
                movie.original_title ||
                movie.original_name ||
                ''
            ).toLowerCase();

        var year =
            String(
                movie.release_date ||
                movie.first_air_date ||
                movie.year ||
                ''
            ).substring(0, 4);

        var exact = null;

        items.forEach(function (item) {

            var name =
                String(
                    item.Name || ''
                ).toLowerCase();

            var itemOriginal =
                String(
                    item.OriginalTitle || ''
                ).toLowerCase();

            var itemYear =
                String(
                    item.ProductionYear || ''
                );

            if (
                name === title ||
                name === original ||
                itemOriginal === title ||
                itemOriginal === original
            ) {

                if (
                    !year ||
                    !itemYear ||
                    itemYear === year
                ) {
                    exact = item;
                }

            }

        });

        if (exact) {
            return exact;
        }

        return items[0] || null;
    }


    /* ============================================================
     * CARD
     * ============================================================ */

    function makeCard(item, callback) {

        var card =
            $('<div class="card selector"></div>');

        var image =
            $('<img class="card__img">');

        var src =
            imageUrl(
                item,
                'Primary'
            );

        if (src) {
            image.attr(
                'src',
                src
            );
        }

        card.append(image);

        var title =
            $('<div class="card__title"></div>');

        title.text(
            item.Name || ''
        );

        card.append(title);

        card.on(
            'hover:enter',
            function () {

                if (callback) {
                    callback(item);
                }

            }
        );

        return card;
    }


    /* ============================================================
     * BASE LIST COMPONENT
     * ============================================================ */

    function createBaseList(object) {

        var self = this;

        this.scroll =
            new Lampa.Scroll({
                mask: true,
                over: true
            });

        this.html =
            $('<div></div>');

        this.grid =
            $('<div class="cards cards--collection"></div>');

        this.html.append(
            this.grid
        );

        this.scroll.append(
            this.html
        );

        this.render = function () {
            return self.scroll.render();
        };

        this.start = function () {

            Lampa.Controller.add(
                'content',
                {

                    toggle:
                        function () {

                            Lampa.Controller
                                .collectionSet(
                                    self.scroll.render(),
                                    self.grid
                                );

                            Lampa.Controller
                                .collectionFocus(
                                    false,
                                    self.scroll.render()
                                );
                        },

                    up:
                        function () {

                            if (
                                Navigator.canmove(
                                    'up'
                                )
                            ) {
                                Navigator.move(
                                    'up'
                                );
                            }
                        },

                    down:
                        function () {

                            if (
                                Navigator.canmove(
                                    'down'
                                )
                            ) {
                                Navigator.move(
                                    'down'
                                );
                            }
                        },

                    left:
                        function () {

                            if (
                                Navigator.canmove(
                                    'left'
                                )
                            ) {
                                Navigator.move(
                                    'left'
                                );
                            } else {
                                Lampa.Controller
                                    .toggle(
                                        'menu'
                                    );
                            }
                        },

                    right:
                        function () {

                            if (
                                Navigator.canmove(
                                    'right'
                                )
                            ) {
                                Navigator.move(
                                    'right'
                                );
                            }
                        },

                    back:
                        function () {
                            self.back();
                        }

                }
            );

            Lampa.Controller.toggle(
                'content'
            );
        };

        this.back = function () {
            Lampa.Activity.backward();
        };

        this.pause = function () {};
        this.stop = function () {};

        this.destroy = function () {
            self.scroll.destroy();
        };
    }


    /* ============================================================
     * MAIN COMPONENT
     * ============================================================ */

    function JellyfinMain(object) {

        var self = this;

        createBaseList.call(
            this,
            object
        );

        this.create = function () {

            if (!config.server) {

                self.showSetup();

                return;
            }

            if (!isAuthorized()) {

                self.showLogin();

                return;
            }

            self.loadMain();

        };


        this.clear = function () {
            self.grid.empty();
        };


        this.addRowButton = function (
            title,
            action
        ) {

            var button = $(
                '<div class="' +
                'simple-menu-item selector">' +
                '<div class="' +
                'simple-menu-item__title">' +
                '</div></div>'
            );

            button.find(
                '.simple-menu-item__title'
            ).text(title);

            button.on(
                'hover:enter',
                action
            );

            self.grid.append(
                button
            );
        };


        this.loadMain = function () {

            self.clear();

            self.addRowButton(
                'Продолжить просмотр',
                function () {
                    self.openResume();
                }
            );

            self.addRowButton(
                'Фильмы',
                function () {
                    self.openMovies();
                }
            );

            self.addRowButton(
                'Сериалы',
                function () {
                    self.openSeries();
                }
            );

            self.addRowButton(
                'Поиск',
                function () {
                    self.openSearch();
                }
            );

            self.addRowButton(
                'Библиотеки',
                function () {
                    self.openLibraries();
                }
            );

            self.addRowButton(
                'Настройки Jellyfin',
                function () {
                    self.showSettings();
                }
            );

            self.addRowButton(
                'Выйти из Jellyfin',
                function () {
                    logout();
                    self.showLogin();
                }
            );

            self.scroll.append(
                self.html
            );

        };


        this.showSetup = function () {

            self.clear();

            self.addRowButton(
                'Настроить Jellyfin',
                function () {
                    self.showSettings();
                }
            );

            self.scroll.append(
                self.html
            );
        };


        this.showLogin = function () {

            var server =
                prompt(
                    'Адрес Jellyfin',
                    config.server ||
                    'http://192.168.1.100:8096'
                );

            if (server === null) {
                return;
            }

            var username =
                prompt(
                    'Имя пользователя Jellyfin',
                    config.username || ''
                );

            if (username === null) {
                return;
            }

            var password =
                prompt(
                    'Пароль Jellyfin',
                    ''
                );

            if (password === null) {
                return;
            }

            config.server =
                server.replace(
                    /\/+$/,
                    ''
                );

            config.username =
                username;

            saveConfig();

            loading(true);

            authenticate(
                username,
                password,
                function () {

                    loading(false);

                    notify(
                        'Успешный вход в Jellyfin'
                    );

                    self.loadMain();

                },
                function (err) {

                    loading(false);

                    notify(
                        typeof err === 'string'
                            ? err
                            : 'Не удалось войти'
                    );

                    self.showSetup();
                }
            );
        };


        this.showSettings = function () {

            var server =
                prompt(
                    'Jellyfin URL',
                    config.server || ''
                );

            if (server === null) {
                return;
            }

            var username =
                prompt(
                    'Пользователь',
                    config.username || ''
                );

            if (username === null) {
                return;
            }

            var password =
                prompt(
                    'Пароль',
                    config.password || ''
                );

            if (password === null) {
                return;
            }

            config.server =
                server.replace(
                    /\/+$/,
                    ''
                );

            config.username =
                username;

            config.password =
                password;

            saveConfig();

            loading(true);

            authenticate(
                username,
                password,
                function () {

                    loading(false);

                    notify(
                        'Настройки сохранены'
                    );

                    self.loadMain();

                },
                function () {

                    loading(false);

                    notify(
                        'Не удалось подключиться к Jellyfin'
                    );

                }
            );
        };


        this.openMovies = function () {

            Lampa.Activity.push({
                url: '',
                title: 'Jellyfin — Фильмы',
                component: 'jellyfin_items',
                jellyfin_type: 'Movie'
            });

        };


        this.openSeries = function () {

            Lampa.Activity.push({
                url: '',
                title: 'Jellyfin — Сериалы',
                component: 'jellyfin_items',
                jellyfin_type: 'Series'
            });

        };


        this.openResume = function () {

            Lampa.Activity.push({
                url: '',
                title: 'Продолжить просмотр',
                component: 'jellyfin_resume'
            });

        };


        this.openLibraries = function () {

            Lampa.Activity.push({
                url: '',
                title: 'Библиотеки Jellyfin',
                component: 'jellyfin_libraries'
            });

        };


        this.openSearch = function () {

            var query =
                prompt(
                    'Поиск в Jellyfin',
                    ''
                );

            if (
                query === null ||
                !query.trim()
            ) {
                return;
            }

            Lampa.Activity.push({
                url: '',
                title:
                    'Jellyfin — ' +
                    query,
                component:
                    'jellyfin_search',
                jellyfin_search:
                    query
            });

        };

    }


    /* ============================================================
     * ITEMS
     * ============================================================ */

    function JellyfinItems(object) {

        var self = this;

        createBaseList.call(
            this,
            object
        );

        this.type =
            object.activity
                .jellyfin_type ||
            'Movie';

        this.create = function () {

            self.activity.loader(
                true
            );

            getItems(
                {
                    types:
                        self.type,

                    recursive:
                        true,

                    limit:
                        100
                },
                function (data) {

                    self.activity.loader(
                        false
                    );

                    var items =
                        data.Items || [];

                    items.forEach(
                        function (item) {

                            self.grid.append(
                                makeCard(
                                    item,
                                    function (
                                        selected
                                    ) {

                                        if (
                                            selected.Type ===
                                            'Movie'
                                        ) {

                                            playItem(
                                                selected
                                            );

                                        } else if (
                                            selected.Type ===
                                            'Series'
                                        ) {

                                            Lampa.Activity.push({
                                                url: '',
                                                title:
                                                    selected.Name,
                                                component:
                                                    'jellyfin_series',
                                                jellyfin_item:
                                                    selected
                                            });

                                        }

                                    }
                                )
                            );

                        }
                    );

                    if (!items.length) {

                        notify(
                            'В Jellyfin ничего не найдено'
                        );

                    }

                },
                function () {

                    self.activity.loader(
                        false
                    );

                    notify(
                        'Ошибка загрузки Jellyfin'
                    );

                }
            );

        };

    }


    /* ============================================================
     * RESUME
     * ============================================================ */

    function JellyfinResume(object) {

        var self = this;

        createBaseList.call(
            this,
            object
        );

        this.create = function () {

            self.activity.loader(
                true
            );

            getResume(
                function (data) {

                    self.activity.loader(
                        false
                    );

                    var items =
                        data.Items || [];

                    items.forEach(
                        function (item) {

                            self.grid.append(
                                makeCard(
                                    item,
                                    function (
                                        selected
                                    ) {

                                        if (
                                            selected.Type ===
                                            'Series'
                                        ) {

                                            Lampa.Activity.push({
                                                url: '',
                                                title:
                                                    selected.Name,
                                                component:
                                                    'jellyfin_series',
                                                jellyfin_item:
                                                    selected
                                            });

                                        } else {

                                            playItem(
                                                selected
                                            );

                                        }

                                    }
                                )
                            );

                        }
                    );

                },
                function () {

                    self.activity.loader(
                        false
                    );

                    notify(
                        'Не удалось получить продолжение просмотра'
                    );

                }
            );

        };

    }


    /* ============================================================
     * SEARCH
     * ============================================================ */

    function JellyfinSearch(object) {

        var self = this;

        createBaseList.call(
            this,
            object
        );

        var query =
            object.activity
                .jellyfin_search ||
            '';

        this.create = function () {

            self.activity.loader(
                true
            );

            search(
                query,
                function (data) {

                    self.activity.loader(
                        false
                    );

                    var items =
                        data.Items || [];

                    items.forEach(
                        function (item) {

                            self.grid.append(
                                makeCard(
                                    item,
                                    function (
                                        selected
                                    ) {

                                        if (
                                            selected.Type ===
                                            'Series'
                                        ) {

                                            Lampa.Activity.push({
                                                url: '',
                                                title:
                                                    selected.Name,
                                                component:
                                                    'jellyfin_series',
                                                jellyfin_item:
                                                    selected
                                            });

                                        } else {

                                            playItem(
                                                selected
                                            );

                                        }

                                    }
                                )
                            );

                        }
                    );

                    if (!items.length) {
                        notify(
                            'Ничего не найдено'
                        );
                    }

                },
                function () {

                    self.activity.loader(
                        false
                    );

                    notify(
                        'Ошибка поиска'
                    );

                }
            );

        };

    }


    /* ============================================================
     * LIBRARIES
     * ============================================================ */

    function JellyfinLibraries(object) {

        var self = this;

        createBaseList.call(
            this,
            object
        );

        this.create = function () {

            self.activity.loader(
                true
            );

            getLibraries(
                function (libraries) {

                    self.activity.loader(
                        false
                    );

                    libraries.forEach(
                        function (library) {

                            var item = $(
                                '<div class="' +
                                'simple-menu-item selector">' +
                                '<div class="' +
                                'simple-menu-item__title">' +
                                '</div>' +
                                '<div class="' +
                                'simple-menu-item__subtitle">' +
                                '</div>' +
                                '</div>'
                            );

                            item.find(
                                '.simple-menu-item__title'
                            ).text(
                                library.Name
                            );

                            item.find(
                                '.simple-menu-item__subtitle'
                            ).text(
                                library.CollectionType ||
                                'Медиатека'
                            );

                            item.on(
                                'hover:enter',
                                function () {

                                    Lampa.Activity.push({
                                        url: '',
                                        title:
                                            library.Name,
                                        component:
                                            'jellyfin_library',
                                        jellyfin_library:
                                            library
                                    });

                                }
                            );

                            self.grid.append(
                                item
                            );

                        }
                    );

                },
                function () {

                    self.activity.loader(
                        false
                    );

                    notify(
                        'Ошибка получения библиотек'
                    );

                }
            );

        };

    }


    /* ============================================================
     * LIBRARY
     * ============================================================ */

    function JellyfinLibrary(object) {

        var self = this;

        createBaseList.call(
            this,
            object
        );

        var library =
            object.activity
                .jellyfin_library;

        this.create = function () {

            self.activity.loader(
                true
            );

            getItems(
                {
                    parentId:
                        library.Id,

                    types:
                        'Movie,Series',

                    recursive:
                        true,

                    limit:
                        100
                },
                function (data) {

                    self.activity.loader(
                        false
                    );

                    var items =
                        data.Items || [];

                    items.forEach(
                        function (item) {

                            self.grid.append(
                                makeCard(
                                    item,
                                    function (
                                        selected
                                    ) {

                                        if (
                                            selected.Type ===
                                            'Series'
                                        ) {

                                            Lampa.Activity.push({
                                                url: '',
                                                title:
                                                    selected.Name,
                                                component:
                                                    'jellyfin_series',
                                                jellyfin_item:
                                                    selected
                                            });

                                        } else {

                                            playItem(
                                                selected
                                            );

                                        }

                                    }
                                )
                            );

                        }
                    );

                },
                function () {

                    self.activity.loader(
                        false
                    );

                    notify(
                        'Ошибка загрузки библиотеки'
                    );

                }
            );

        };

    }


    /* ============================================================
     * SERIES
     * ============================================================ */

    function JellyfinSeries(object) {

        var self = this;

        createBaseList.call(
            this,
            object
        );

        var series =
            object.activity
                .jellyfin_item;

        this.create = function () {

            self.activity.loader(
                true
            );

            getSeasons(
                series.Id,
                function (data) {

                    self.activity.loader(
                        false
                    );

                    var seasons =
                        data.Items || [];

                    seasons.forEach(
                        function (season) {

                            var row = $(
                                '<div class="' +
                                'simple-menu-item selector">' +

                                '<div class="' +
                                'simple-menu-item__title">' +
                                '</div>' +

                                '</div>'
                            );

                            row.find(
                                '.simple-menu-item__title'
                            ).text(
                                season.Name
                            );

                            row.on(
                                'hover:enter',
                                function () {

                                    Lampa.Activity.push({
                                        url: '',
                                        title:
                                            season.Name,
                                        component:
                                            'jellyfin_episodes',
                                        jellyfin_series:
                                            series,
                                        jellyfin_season:
                                            season
                                    });

                                }
                            );

                            self.grid.append(
                                row
                            );

                        }
                    );

                },
                function () {

                    self.activity.loader(
                        false
                    );

                    notify(
                        'Ошибка загрузки сезонов'
                    );

                }
            );

        };

    }


    /* ============================================================
     * EPISODES
     * ============================================================ */

    function JellyfinEpisodes(object) {

        var self = this;

        createBaseList.call(
            this,
            object
        );

        var series =
            object.activity
                .jellyfin_series;

        var season =
            object.activity
                .jellyfin_season;

        this.create = function () {

            self.activity.loader(
                true
            );

            getEpisodes(
                series.Id,
                season.Id,
                function (data) {

                    self.activity.loader(
                        false
                    );

                    var episodes =
                        data.Items || [];

                    episodes.forEach(
                        function (episode) {

                            var row = $(
                                '<div class="' +
                                'simple-menu-item selector">' +

                                '<div class="' +
                                'simple-menu-item__title">' +
                                '</div>' +

                                '<div class="' +
                                'simple-menu-item__subtitle">' +
                                '</div>' +

                                '</div>'
                            );

                            var number =
                                episode.IndexNumber ||
                                '';

                            row.find(
                                '.simple-menu-item__title'
                            ).text(
                                'Серия ' +
                                number +
                                ' — ' +
                                (
                                    episode.Name ||
                                    ''
                                )
                            );

                            row.find(
                                '.simple-menu-item__subtitle'
                            ).text(
                                episode.Overview ||
                                ''
                            );

                            row.on(
                                'hover:enter',
                                function () {

                                    playItem(
                                        episode
                                    );

                                }
                            );

                            self.grid.append(
                                row
                            );

                        }
                    );

                },
                function () {

                    self.activity.loader(
                        false
                    );

                    notify(
                        'Ошибка загрузки серий'
                    );

                }
            );

        };

    }


    /* ============================================================
     * REGISTER COMPONENTS
     * ============================================================ */

    Lampa.Component.add(
        'jellyfin_source',
        JellyfinMain
    );

    Lampa.Component.add(
        'jellyfin_items',
        JellyfinItems
    );

    Lampa.Component.add(
        'jellyfin_resume',
        JellyfinResume
    );

    Lampa.Component.add(
        'jellyfin_search',
        JellyfinSearch
    );

    Lampa.Component.add(
        'jellyfin_libraries',
        JellyfinLibraries
    );

    Lampa.Component.add(
        'jellyfin_library',
        JellyfinLibrary
    );

    Lampa.Component.add(
        'jellyfin_series',
        JellyfinSeries
    );

    Lampa.Component.add(
        'jellyfin_episodes',
        JellyfinEpisodes
    );


    /* ============================================================
     * MENU
     * ============================================================ */

    function addMenu() {

        if (
            !Lampa.Menu ||
            !Lampa.Menu.addButton
        ) {
            return;
        }

        var icon =
            '<svg width="24" height="24" ' +
            'viewBox="0 0 24 24" ' +
            'fill="currentColor">' +

            '<path d="' +
            'M4 4h16v16H4zM7 7v10h2V7H7zm4 0v10h2V7h-2zm4 0v10h2V7h-2z' +
            '"/>' +

            '</svg>';

        Lampa.Menu.addButton(
            icon,
            'Jellyfin',
            function () {

                Lampa.Activity.push({
                    url: '',
                    title: 'Jellyfin',
                    component:
                        'jellyfin_source'
                });

            }
        );
    }


    /* ============================================================
     * ONLINE SOURCE
     *
     * Добавляет Jellyfin в систему источников Lampa.
     * ============================================================ */

    function registerSource() {

        if (
            !Lampa.Online ||
            !Lampa.Online.register
        ) {
            return;
        }

        try {

            Lampa.Online.register(
                'jellyfin',
                {

                    title:
                        'Jellyfin',

                    search:
                        function (
                            movie,
                            oncomplite
                        ) {

                            if (
                                !isAuthorized()
                            ) {

                                if (oncomplite) {
                                    oncomplite([]);
                                }

                                return;
                            }

                            var query =
                                movie.title ||
                                movie.name ||
                                movie.original_title ||
                                movie.original_name ||
                                '';

                            search(
                                query,
                                function (data) {

                                    var results =
                                        [];

                                    (
                                        data.Items ||
                                        []
                                    ).forEach(
                                        function (
                                            item
                                        ) {

                                            var card =
                                                normalize(
                                                    item
                                                );

                                            card.jellyfin_item =
                                                item;

                                            results.push(
                                                card
                                            );

                                        }
                                    );

                                    if (
                                        oncomplite
                                    ) {
                                        oncomplite(
                                            results
                                        );
                                    }

                                },
                                function () {

                                    if (
                                        oncomplite
                                    ) {
                                        oncomplite(
                                            []
                                        );
                                    }

                                }
                            );

                        },

                    onContextMenu:
                        function () {

                            return {
                                name:
                                    'Jellyfin'
                            };

                        }

                }
            );

        } catch (e) {

            console.log(
                '[Jellyfin] Online source error',
                e
            );

        }

    }


    /* ============================================================
     * CLEANUP
     * ============================================================ */

    Lampa.Listener.follow(
        'activity',
        function (event) {

            if (
                event.type === 'destroy'
            ) {

                /*
                 * Если пользователь вышел из
                 * плеера, пытаемся отправить
                 * последнюю позицию.
                 */
                if (
                    currentPlayback &&
                    currentPlayback.item
                ) {

                    var video =
                        findVideoElement();

                    if (video) {

                        reportStopped(
                            currentPlayback.item,
                            Number(
                                video.currentTime ||
                                0
                            )
                        );

                    }

                    stopProgressTracking();

                }

            }

        }
    );


    /* ============================================================
     * START
     * ============================================================ */

    function startPlugin() {

        if (
            window.jellyfin_source_started
        ) {
            return;
        }

        window.jellyfin_source_started =
            true;

        addMenu();

        addFullButton();

        registerSource();

        console.log(
            '[Jellyfin Source] v' +
            VERSION +
            ' started'
        );
    }


    function bootstrap() {

        if (
            typeof Lampa ===
            'undefined'
        ) {

            setTimeout(
                bootstrap,
                300
            );

            return;
        }

        if (window.appready) {

            startPlugin();

        } else if (
            Lampa.Listener &&
            Lampa.Listener.follow
        ) {

            Lampa.Listener.follow(
                'app',
                function (event) {

                    if (
                        event.type ===
                        'ready'
                    ) {
                        startPlugin();
                    }

                }
            );

            setTimeout(
                function () {

                    if (
                        window.appready
                    ) {
                        startPlugin();
                    }

                },
                1500
            );

        } else {

            startPlugin();

        }
    }


    bootstrap();

})();
