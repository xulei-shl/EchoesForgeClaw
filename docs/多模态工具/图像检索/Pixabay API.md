## Pixabay API

Welcome to the Pixabay API documentation. Our API is a RESTful interface for searching and retrieving royalty-free images and videos released by Pixabay under the [Content License](https://pixabay.com/service/terms/).

If you make use of the API, show your users where the images and videos are from, whenever search results are displayed. That's the one thing we kindly request in return for free API usage.

The API returns JSON-encoded objects. Hash keys and values are case-sensitive and character encoding is in UTF-8. Hash keys may be returned in any random order and new keys may be added at any time. We will do our best to notify our users before removing hash keys from results or adding required parameters.

## Rate Limit

By default, you can make up to 100 requests per 60 seconds. Requests are associated with the API key, and not with your IP address. The response headers tell you everything you need to know about your current rate limit status:

| Header name           | Description                                                  |
| --------------------- | ------------------------------------------------------------ |
| X-RateLimit-Limit     | The maximum number of requests that the consumer is permitted to make in 60 seconds. |
| X-RateLimit-Remaining | The number of requests remaining in the current rate limit window. |
| X-RateLimit-Reset     | The remaining time in seconds after which the current rate limit window resets. |

To keep the Pixabay API fast for everyone, requests must be cached for 24 hours. Also, the API is made for real human requests; do not send lots of automated queries. Systematic mass downloads are not allowed. If needed, we can increase this limit at any time - given that you've implemented the API properly.

## Hotlinking

Returned image URLs may be used for temporarily displaying search results. However, permanent hotlinking of images (using Pixabay URLs in your app) is not allowed. If you intend to use the images, please download them to your server first. Videos may be embedded directly in your applications. Yet, we recommend storing them on your server.

## Error Handling

If an error occurs, a response with propper HTTP error status code is returned. The body of this response contains a description of the issue in plain text. For example, once you go over the rate limit you will receive an HTTP error 429 ("Too Many Requests") with the message "API rate limit exceeded".

## Search Images

### Parameters

| key (required)  | str    | Your API key: **57183137-020804183c6a0efe6ba151445** [Rotate](https://pixabay.com/accounts/settings/rotate-api-key/) |
| --------------- | ------ | ------------------------------------------------------------ |
| q               | str    | A URL encoded search term. If omitted, *all images* are returned. This value may not exceed 100 characters.   Example: "yellow+flower" |
| lang            | str    | [Language code](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) of the language to be searched in.   Accepted values: cs, da, de, en, es, fr, id, it, hu, nl, no, pl, pt, ro, sk, fi, sv, tr, vi, th, bg, ru, el, ja, ko, zh   Default: "en" |
| id              | str    | Retrieve individual images by ID.                            |
| image\_type     | str    | Filter results by image type.   Accepted values: "all", "photo", "illustration", "vector"   Default: "all" |
| orientation     | str    | Whether an image is wider than it is tall, or taller than it is wide.   Accepted values: "all", "horizontal", "vertical"   Default: "all" |
| category        | str    | Filter results by category.   Accepted values: backgrounds, fashion, nature, science, education, feelings, health, people, religion, places, animals, industry, computer, food, sports, transportation, travel, buildings, business, music |
| min\_width      | int    | Minimum image width.   Default: "0"                          |
| min\_height     | int    | Minimum image height.   Default: "0"                         |
| colors          | str    | Filter images by color properties. A comma separated list of values may be used to select multiple properties.   Accepted values: "grayscale", "transparent", "red", "orange", "yellow", "green", "turquoise", "blue", "lilac", "pink", "white", "gray", "black", "brown" |
| editors\_choice | bool   | Select images that have received an [Editor's Choice](https://pixabay.com/editors_choice/) award.   Accepted values: "true", "false"   Default: "false" |
| safesearch      | bool   | A flag indicating that only images suitable for all ages should be returned.   Accepted values: "true", "false"   Default: "false" |
| order           | str    | How the results should be ordered.   Accepted values: "popular", "latest"   Default: "popular" |
| page            | int    | Returned search results are paginated. Use this parameter to select the page number.   Default: 1 |
| per\_page       | int    | Determine the number of results per page.   Accepted values: 3 - 200   Default: 20 |
| callback        | string | JSONP callback function name                                 |
| pretty          | bool   | Indent JSON output. This option should not be used in production.   Accepted values: "true", "false"   Default: "false" |

### Example

Retrieving photos of "yellow flowers". The search term **q** needs to be URL encoded:

Response for this request:

```javascript
{
"total": 4692,
"totalHits": 500,
"hits": [
    {
        "id": 195893,
        "pageURL": "https://pixabay.com/en/blossom-bloom-flower-195893/",
        "type": "photo",
        "tags": "blossom, bloom, flower",
        "previewURL": "https://cdn.pixabay.com/photo/2013/10/15/09/12/flower-195893_150.jpg"
        "previewWidth": 150,
        "previewHeight": 84,
        "webformatURL": "https://pixabay.com/get/35bbf209e13e39d2_640.jpg",
        "webformatWidth": 640,
        "webformatHeight": 360,
        "largeImageURL": "https://pixabay.com/get/ed6a99fd0a76647_1280.jpg",
        "fullHDURL": "https://pixabay.com/get/ed6a9369fd0a76647_1920.jpg",
        "imageURL": "https://pixabay.com/get/ed6a9364a9fd0a76647.jpg",
        "imageWidth": 4000,
        "imageHeight": 2250,
        "imageSize": 4731420,
        "views": 7671,
        "downloads": 6439,
        "likes": 5,
        "comments": 2,
        "user_id": 48777,
        "user": "Josch13",
        "userImageURL": "https://cdn.pixabay.com/user/2013/11/05/02-10-23-764_250x250.jpg",
    },
    {
        "id": 73424,
        ...
    },
    ...
]
}
```

| Response key   | Description                                                  |
| -------------- | ------------------------------------------------------------ |
| total          | The total number of hits.                                    |
| totalHits      | The number of images accessible through the API. By default, the API is limited to return a maximum of 500 images per query. |
| id             | A unique identifier for this image.                          |
| pageURL        | Source page on Pixabay, which provides a download link for the original image of the dimension imageWidth x imageHeight and the file size imageSize. |
| previewURL     | Low resolution images with a maximum width or height of 150 px (previewWidth x previewHeight). |
| webformatURL   | Medium sized image with a maximum width or height of 640 px (webformatWidth x webformatHeight). URL valid for 24 hours.  **Replace '\_640' in any webformatURL value to access other image sizes:**   Replace with '\_180' or '\_340' to get a 180 or 340 px tall version of the image, respectively. Replace with '\_960' to get the image in a maximum dimension of 960 x 720 px. |
| largeImageURL  | Scaled image with a maximum width/height of 1280px.          |
| views          | Total number of views.                                       |
| downloads      | Total number of downloads.                                   |
| likes          | Total number of likes.                                       |
| comments       | Total number of comments.                                    |
| user\_id, user | User ID and name of the contributor. Profile URL: [https://pixabay.com/users/{](https://pixabay.com/users/%7B) USERNAME }-{ ID }/ |
| userImageURL   | Profile picture URL (250 x 250 px).                          |

The following response key/value pairs are only available if your account has been [approved for full API access](#). These URLs give you access to the original images in full resolution and - if available - in vector format:

| Response key | Description                                                 |
| ------------ | ----------------------------------------------------------- |
| fullHDURL    | Full HD scaled image with a maximum width/height of 1920px. |
| imageURL     | URL to the original image (imageWidth x imageHeight).       |
| vectorURL    | URL to a vector resource if available, else omitted.        |

## Search Videos

**GET** [https://pixabay.com/api/videos/](https://pixabay.com/api/videos/)

### Parameters

| key (required)  | str    | Your API key: **57183137-020804183c6a0efe6ba151445** [Rotate](https://pixabay.com/accounts/settings/rotate-api-key/) |
| --------------- | ------ | ------------------------------------------------------------ |
| q               | str    | A URL encoded search term. If omitted, *all videos* are returned. This value may not exceed 100 characters.   Example: "yellow+flower" |
| lang            | str    | [Language code](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes) of the language to be searched in.   Accepted values: cs, da, de, en, es, fr, id, it, hu, nl, no, pl, pt, ro, sk, fi, sv, tr, vi, th, bg, ru, el, ja, ko, zh   Default: "en" |
| id              | str    | Retrieve individual videos by ID.                            |
| video\_type     | str    | Filter results by video type.   Accepted values: "all", "film", "animation"   Default: "all" |
| category        | str    | Filter results by category.   Accepted values: backgrounds, fashion, nature, science, education, feelings, health, people, religion, places, animals, industry, computer, food, sports, transportation, travel, buildings, business, music |
| min\_width      | int    | Minimum video width.   Default: "0"                          |
| min\_height     | int    | Minimum video height.   Default: "0"                         |
| editors\_choice | bool   | Select videos that have received an [Editor's Choice](https://pixabay.com/editors_choice/) award.   Accepted values: "true", "false"   Default: "false" |
| safesearch      | bool   | A flag indicating that only videos suitable for all ages should be returned.   Accepted values: "true", "false"   Default: "false" |
| order           | str    | How the results should be ordered.   Accepted values: "popular", "latest"   Default: "popular" |
| page            | int    | Returned search results are paginated. Use this parameter to select the page number.   Default: 1 |
| per\_page       | int    | Determine the number of results per page.   Accepted values: 3 - 200   Default: 20 |
| callback        | string | JSONP callback function name                                 |
| pretty          | bool   | Indent JSON output. This option should not be used in production.   Accepted values: "true", "false"   Default: "false" |

### Example

Retrieving videos about "yellow flowers". The search term **q** needs to be URL encoded.

[https://pixabay.com/api/videos/?key=57183137-020804183c6a0efe6ba151445&q=yellow+flowers](https://pixabay.com/api/videos/?key=57183137-020804183c6a0efe6ba151445&q=yellow+flowers&pretty=true)

Response for this request:

```javascript
{
"total": 42,
"totalHits": 42,
"hits": [
    {
        "id": 125,
        "pageURL": "https://pixabay.com/videos/id-125/",
        "type": "film",
        "tags": "flowers, yellow, blossom",
        "duration": 12,
        "videos": {
            "large": {
                "url": "https://cdn.pixabay.com/video/2015/08/08/125-135736646_large.mp4",
                "width": 1920,
                "height": 1080,
                "size": 6615235,
                "thumbnail": "https://cdn.pixabay.com/video/2015/08/08/125-135736646_large.jpg"
            },
            "medium": {
                "url": "https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.mp4",
                "width": 1280,
                "height": 720,
                "size": 3562083,
                "thumbnail": "https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.jpg"
            },
            "small": {
                "url": "https://cdn.pixabay.com/video/2015/08/08/125-135736646_small.mp4",
                "width": 640,
                "height": 360,
                "size": 1030736,
                "thumbnail": "https://cdn.pixabay.com/video/2015/08/08/125-135736646_small.jpg"
            },
            "tiny": {
                "url": "https://cdn.pixabay.com/video/2015/08/08/125-135736646_tiny.mp4",
                "width": 480,
                "height": 270,
                "size": 426799,
                "thumbnail": "https://cdn.pixabay.com/video/2015/08/08/125-135736646_tiny.jpg"
            }
        },
        "views": 4462,
        "downloads": 1464,
        "likes": 18,
        "comments": 0,
        "user_id": 1281706,
        "user": "Coverr-Free-Footage",
        "userImageURL": "https://cdn.pixabay.com/user/2015/10/16/09-28-45-303_250x250.png"
    },
    {
        "id": 473,
        ...
    },
    ...
]
}
```

Response keyDescriptiontotalThe total number of hits.totalHitsThe number of videos accessible through the API. By default, the API is limited to return a maximum of 500 videos per query.idA unique identifier for this video.pageURLSource page on Pixabay.videos

A set of differently sizes video streams:

- **`large`** usually has a dimension of 3840x2160. If a large video version is not available, an empty URL value and a size of zero is returned.
- **`medium`** usually has a dimension of 1920x1080, older videos have a dimension of 1280x720. This size is available for all Pixabay videos.
- **`small`** typically has a dimension of 1280x720, older videos have a dimension of 960x540. This size is available for all videos.
- **`tiny`** typically has a dimension of 960x540, older videos have a dimension of 640x360. This size is available for all videos.

| Object key | Description                                                  |
| ---------- | ------------------------------------------------------------ |
| url        | The video URL. Append the GET parameter `download=1` to the value to have the browser download it. |
| width      | The width of the video and thumbnail.                        |
| height     | The height of the video and thumbnail.                       |
| size       | The approximate size of the video in bytes.                  |
| thumbnail  | The URL of the poster image for this rendition.              |

viewsTotal number of views.downloadsTotal number of downloads.likesTotal number of likes.commentsTotal number of comments.user\_id, userUser ID and name of the contributor. Profile URL: [https://pixabay.com/users/{](https://pixabay.com/users/%7B) USERNAME }-{ ID }/userImageURLProfile picture URL (250 x 250 px).

## JavaScript Example

```javascript
var API_KEY = '57183137-020804183c6a0efe6ba151445';
var URL = "https://pixabay.com/api/?key="+API_KEY+"&q="+encodeURIComponent('red roses');
$.getJSON(URL, function(data){
if (parseInt(data.totalHits) > 0)
    $.each(data.hits, function(i, hit){ console.log(hit.pageURL); });
else
    console.log('No hits');
});
```

## Support

[Request full API access](#) for retrieving high resolution images.