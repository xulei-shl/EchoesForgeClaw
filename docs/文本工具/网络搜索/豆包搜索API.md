本文档介绍 **豆包搜索Custom版**（原名 联网搜索 / 融合信息搜索）接口的输入输出参数。调用该接口可获取搜索词相关的搜索结果，您可根据这些数据适配项目使用。


* 搜索类型包括

   * **web搜索**：满足多样的常规搜索需求，用户可获取所需的高质量内容，通过传参可控制搜索**web网页**或**image图片**。

* Custom版 支持 按量后付费、订阅套餐 两种计费模式，通过各自独立的 API Key 使用进行响应计费；

* 查看[搜索版本差异说明](https://www.volcengine.com/docs/87772/2272949?lang=zh)；


> **web搜索\-总结版**（2026年6月23日起不再支持新增开通，搜索总结需求可使用 [联网问答Agent产品](https://console.volcengine.com/ask-echo/agent-collab)，接口文档可参考 [联网问答Agent-Collab](https://www.volcengine.com/docs/85508/2208447?lang=zh)）：在此基础上提供大模型内容总结，以获得提炼总结后的一段式内容，提升信息获取效率，仅支持搜索web网页进行总结。


接口限流：账号维度，默认 5 QPS，接入方可根据实际需要提工单扩容。（Global版和Custom版的并发限流相互独立）

免费额度：每个火山账号每月可免费调用500次联网搜索（额度与Global版共用，不区分SearchType、付费类型），无论是否开通付费都将被优先消耗；

> 对个人认证账号（及未认证账号）每月可免费调用500次自2026年3月17日起生效；

> 对企业认证账号每月可免费调用500次自2026年5月14日期生效；



---




# 认证方式

提供APIKey接入和TOP网关接入两种方式，两种接入方式有不同的URL。


## APIKey接入(推荐)


1. 获取API Key

   1. **订阅套餐（预付费）** ：登陆并进入 [联网搜索控制台 - API Key管理 - 订阅套餐](https://console.volcengine.com/search-infinity/api-key?tab=subscription_plan)；

   2. **按量计费（后付费）** ：登陆并进入 [联网搜索控制台 - API Key管理 - 按量后付费](https://console.volcengine.com/search-infinity/api-key?tab=post_paid)；

   3. 在弹出的名称文本框中填写 API Key 名称，单击创建。


> 说明：请妥善保存好API Key，强烈建议您不要将其直接写入到调用模型的代码中。



2. 签名构造


API Key 签名鉴权方式要求在 HTTP 请求 header 中按如下方式添加 Authorization:

```Bash
Authorization: Bearer <API_KEY>
```


我们提供postman、python的demo文件供您使用，填写APIKEY信息后可直接发起调用

<Attachment link="https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_a15f012313e656f8654dc63b53157e59.zip" name="apikey访问方式demo文件.zip">apikey访问方式demo文件.zip</Attachment>



## 火山引擎TOP网关接入

此接入方式基于火山引擎IAM的AK/SK鉴权，统一使用 ServiceName=volc_torchlight_api


1. 接口验签及请求公共参数逻辑遵循火山引擎官网的统一规范，详情请参见：[签名方法--API签名调用指南-火山引擎](https://www.volcengine.com/docs/6369/67269)；

2. 开通账号权限后，可获取AccessKey进行验签，详情请参见：[Access Key(密钥)管理--API访问密钥(Access Key)-火山引擎](https://www.volcengine.com/docs/6291/65568)。


注意：


* 若使用主账号  **(强烈不建议，主账号权限过大)**  接入，可跳过此步骤，忽略此前提；

* 若为子账号接入，需要首先登录[控制台](https://console.volcengine.com/search-infinity/web-search)，开通接口访问权限；否则会报错**100013:AccessDenied错误;** 

* 开通接口权限步骤：

   1. 使用火山引擎控制台主账号，登录控制台；

   2. 点击用户头像进入访问控制模块，在用户模块点击管理按钮进入子账号权限管理界面；

   3. 切换到权限TAB，点击添加权限按钮，在搜索栏输入“**TorchlightApiFullAccess**”权限，并选中确认；

   4. 若有多个子账号访问平台，需对每个子账号进行相应权限配置。

* 开通控制台权限步骤：

   * 参考接口权限开通操作，给子账号添加**ContentCustomFullAccess**权限。


我们提供python的demo文件供您使用，填写AK和SK信息后可直接发起调用

<Attachment link="https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_43b1d408513f9f903c03936ba5860fcb.zip" name="aksk访问方式demo文件.zip">aksk访问方式demo文件.zip</Attachment>



---




# 接口详情


## URL


| URL           | * API Key接入：https://open.feedcoopapi.com/search_api/web_search<br><br>* 基于火山引擎IAM的AK/SK鉴权：https://mercury.volcengineapi.com?Action=WebSearch&Version=2025\-01\-01 |
| ------------- | ------------------------------------------------------------ |
| Method        | POST                                                         |
| Content\-Type | application/json                                             |



## 请求


### Request


* web搜索



| **字段名(一级)** | **字段名(二级)** | **类型** | **必须** | **说明**                                                     |
| ---------------- | ---------------- | -------- | -------- | ------------------------------------------------------------ |
| Query            |                  | String   | 是       | 用户搜索query，**1~100**个字符(过长会截断)，不支持多词搜索   |
| SearchType       |                  | String   | 是       | 搜索类型枚举值，目前支持<br><br><br>* web：需开通【web搜索】，返回搜索到的站点信息 |
| Count            |                  | Number   | 否       | 返回结果条数，**最多50条，默认10条**                         |
| Filter           |                  | Object   | 否       | 过滤条件                                                     |
|                  | NeedContent      | Boolean  | 否       | 是否仅返回有正文的结果，默认false（不限制必须有正文）        |
|                  | NeedUrl          | Boolean  | 否       | 是否仅返回原文链接的结果<br><br><br>* false：默认，不限制返回一定有Url的结果<br><br>* true：强制返回有Url的结果（会滤掉如意结果） |
|                  | Sites            | String   | 否       | 指定搜索的站点范围，多个站点使用'\|'分隔，最多支持20个。<br><br>需填入完整域名，示例：aliyun.com\|mp.qq.com |
|                  | BlockHosts       | String   | 否       | 指定屏蔽的搜索Site，多个域名使用'\|'分隔，最多支持5个。<br><br>需填入完整域名，示例：aliyun.com\|mp.qq.com |
|                  | AuthInfoLevel    | Number   | 否       | 指定仅在非常权威内容范围内搜索（详情请参考：[站点权威度说明可参考](https://www.volcengine.com/docs/87772/2518319?lang=zh)），默认为0<br><br>0：不限制搜索结果的权威等级<br><br>1：限制搜索结果为【非常权威】（搜索结果会减少，并过滤掉如意结果） |
| TimeRange        |                  | String   | 否       | 指定搜索的发文时间。<br><br>以下枚举值，不填即为不限制<br><br><br>* OneDay：1天内<br><br>* OneWeek：1周内<br><br>* OneMonth：1月内<br><br>* OneYear：1年内<br><br>* YYYY\-MM\-DD..YYYY\-MM\-DD：从日期A（包含）至日期B（包含）区间段内发文的内容，示例"2024\-12\-30..2025\-12\-30" |
| QueryControl     |                  |          |          |                                                              |
|                  | QueryRewrite     | Boolean  | 否       | 是否开启Query改写（开启后会增加搜索耗时），默认false（不开启） |
| ContentFormats   |                  | String   | 否       | 指定返回正文的格式，默认为Text<br><br><br>* text：text格式<br><br>* markdown：markdown格式 |
| Industry<br><br> |                  | String   | 否       | 执行行业类型搜索，支持<br><br><br>* finance，金融<br><br>* game，电子游戏<br><br>* health，健康，优先在健康、医疗相关的网站中搜索。<br><br>* gov，包括政府网站、央媒/地区官媒、国家机构、国家级官方协会等，是[非常权威](https://www.volcengine.com/docs/87772/2518319?lang=zh)的子集，权威限制更严格。<br><br><br>（执行行业搜索时，搜索结果会减少，并过滤掉如意结果） |



* image搜索



| **字段名(一级)** | **字段名(二级)** | **类型**       | **必须** | **说明**                                                     |
| ---------------- | ---------------- | -------------- | -------- | ------------------------------------------------------------ |
| Query            |                  | String         | 是       | 用户搜索query，**1~100**个字符(过长会截断)，不支持多词搜索   |
| SearchType       |                  | String         | 是       | 搜索类型枚举值，目前支持<br><br><br>* image：需开通【web搜索】，返回搜索到的图片信息 |
| Count            |                  | Number         | 否       | 返回条数，最多5条                                            |
| Filter           |                  |                | 否       | 过滤条件                                                     |
|                  | ImageWidthMin    | Number         |          | 最小宽度                                                     |
|                  | ImageHeightMin   | Number         |          | 最小高度                                                     |
|                  | ImageWidthMax    | Number         |          | 最大宽度                                                     |
|                  | ImageHeightMax   | Number         |          | 最大高度                                                     |
|                  | ImageShapes      | Array<String\> |          | 允许的形状，枚举值：横长方形、竖长方形、方形                 |
| QueryControl     |                  |                | 否       |                                                              |
|                  | QueryRewrite     | Boolean        | 否       | 是否开启Query改写（开启后会增加搜索耗时），默认false（不开启） |



## 响应

### Response


| **字段名**       | **类型** | **必须** | **说明**                            |
| ---------------- | -------- | -------- | ----------------------------------- |
| ResponseMetadata | Object   | 是       | 统一响应元信息                      |
| Result           |          | 否       | 请求成功时的搜索结果；失败时为 null |



### ResponseMetadata


| **字段名** | **类型** | **必须** | **说明**                             |
| ---------- | -------- | -------- | ------------------------------------ |
| RequestId  | String   | 是       | 请求 ID                              |
| Action     | String   | 是       | TOP网关接口名，仅TOP网关接入有值     |
| Version    | String   | 是       | TOP网关接口版本号，仅TOP网关接入有值 |
| Service    | String   | 是       | TOP网关服务名，仅TOP网关接入有值     |
| Region     | String   | 是       | 服务区域，仅TOP网关接入有值          |
| Error      | Object   | 否       | 接口层错误信息。                     |



### **Result\-搜索结果**


| **字段名**    | **类型**         | **必须** | **说明**                                                     |
| ------------- | ---------------- | -------- | ------------------------------------------------------------ |
| ResultCount   | Number           | 是       | 搜索到的结果数                                               |
| WebResults    | Array[WebItem]   | 否       | 返回的搜索列表，结构见WebItem，仅search_type=**web**有值     |
| ImageResults  | Array[ImageItem] | 否       | 返回的搜索列表，结构见ImageItem，search_type=**image**有值   |
| SearchContext | SearchContext    | 是       | 搜索上下文信息，结构见WebItem，SearchContext. 主要包含原始Query、SearchType等信息 |
| TimeCost      | Number           | 是       | 耗时，毫秒                                                   |
| LogId         | String           | 是       | 日志Id，和Response Header中的X\-Tt\-Logid相同                |
| CardResults   | Array            | 否       | 卡片结构化数据形式的 **火山如意** 结果，类型见下方CardType卡片类型（是WebResults中 火山如意 结果的子集），数据结构详见[火山如意数据结构](https://www.volcengine.com/docs/85508/1995628?lang=zh)，仅search_type=**web或web_summary**有值 |



### **WebItem\-搜索网页结果详情**

> Web搜索结果项



| **字段名(一级)** | **字段名(二级)** | **类型** | **必须** | **说明**                                                     |
| ---------------- | ---------------- | -------- | -------- | ------------------------------------------------------------ |
| Id               |                  | String   | 是       | 结果Id                                                       |
| SortId           |                  | Number   | 是       | 排序Id                                                       |
| Title            |                  | String   | 是       | 标题                                                         |
| SiteName         |                  | String   | 否       | 站点名                                                       |
| Url              |                  | String   | 否       | 落地页                                                       |
| Snippet          |                  | String   | 是       | 简短片段（约200字）<br><br>字数限制导致缺失相关信息，**仅建议用于搜索结果的列表展示**，强烈不建议用于大模型场景。 |
| Summary          |                  | String   | 否       | 相关摘要：搜索结果正文中和query相关的片段（500~1000字）<br><br>同时考虑内容完整性和字数长度，**推荐用于大模型场景** |
| Content          |                  | String   | 否       | 正文（引用站点正文）                                         |
| PublishTime      |                  | String   | 否       | 发布时间，ISO时间格式<br><br>示例：2025\-05\-30T19:35:24+08:00 |
| LogoUrl          |                  | String   | 否       | 落地页IconUrl链接                                            |
| RankScore        |                  | Float    | 否       | 相关性得分（0~1分）                                          |
| AuthInfoDes      |                  | String   | 是       | 权威度描述（详情请参考：[站点权威度说明可参考](https://www.volcengine.com/docs/87772/2518319?lang=zh)），包括<br><br><br>* 非常权威<br><br>* 正常权威<br><br>* 一般权威<br><br>* 一般不权威 |
| AuthInfoLevel    |                  | Number   | 是       | 权威度描述（详情请参考：[站点权威度说明可参考](https://www.volcengine.com/docs/87772/2518319?lang=zh)），包括<br><br><br>* 1（非常权威）<br><br>* 2（正常权威）<br><br>* 3（一般权威）<br><br>* 4（一般不权威） |
| ContentFormats   |                  | String   | 否       | 实际返回的正文格式<br><br><br>* text：text格式<br><br>* markdown：markdown格式 |
| RuyiInfo         |                  |          | 否       | 仅当Sitename=“火山如意”时有值                                |
|                  | Type             | String   | 否       | WebItem形式的 **火山如意** 结果类型，包含以下值：<br><br><br>* stock: 股票<br><br>* weather: 天气<br><br>* travel_restriction: 限行<br><br>* oil_price: 油价<br><br>* house_price: 二手房房价/租金<br><br>* metal: 贵金属<br><br>* exchange_rate: 汇率<br><br>* holiday_plan: 节假日<br><br>* hot_media: 影视综<br><br>* calendar: 日历/黄历<br><br>* kefu_number: 客服电话<br><br>* subway_line: 地铁线路<br><br>* car_model: 车型介绍<br><br>* lottery: 彩票<br><br>* local_service_guide：本地办事指南<br><br>* hanzi_detail：汉字<br><br>* shengxiao：生肖查询<br><br>* travel_food：当地美食<br><br>* constellation_detail：星座运势<br><br>* train_schedule：火车车次详情<br><br>* train_route：两地火车查询<br><br>* fligh_troute：两地航班查询<br><br>* constellation：星座查询<br><br>* sports_match：篮球足球赛事<br><br>* guoxue_bihuazi：笔画<br><br>* hanzi_pianpang：偏旁<br><br>* gsw_shici：古诗词<br><br>* zipcode：邮编<br><br>* macro_economy：各地GDP<br><br>* tax_enquiry：个人所得税税率<br><br>* house_price：各地新房二手房房价/房租<br><br>* actor_album：明星作品/作品演员表<br><br>* football_world_cup：世界杯赛程<br><br>* football_world_cup_matchup：世界杯对战信息<br><br>* gaokao_school：高考院校基本信息<br><br>* gaokao_major：高校专业基本信息<br><br>* gaokao_score_line：高考分数线<br><br>* gaokao_admit_score：高校录取分<br><br>* basketball_nba_event：NBA赛程<br><br>* basketball_nba_match：NBA比赛信息<br><br>* basketball_nba_team：NBA球队信息<br><br>* basketball_cba_event：CBA赛程<br><br>* basketball_cba_match：CBA比赛信息<br><br>* basketball_cba_team：CBA球队信息 |



### **SearchContext\-搜索上下文信息**


| **字段名**  | **类型** | **必须** | **说明**                          |
| ----------- | -------- | -------- | --------------------------------- |
| SearchType  | String   | 是       | 搜索类型枚举值，**目前支持"web"** |
| OriginQuery | String   | 是       | 原始Query                         |



### **CardType** **\-卡片类型**

> 卡片结构化数据形式的 **火山如意** 卡片类型，是WebResults中 火山如意 结果的子集。



| 字段名              | 卡片类型            | 必须 | 说明                                                         |
| ------------------- | ------------------- | ---- | ------------------------------------------------------------ |
| CardType            | 卡片类型            | 是   | 卡片类型描述，卡片结构信息详见[火山如意数据结构](https://www.volcengine.com/docs/85508/1995628?lang=zh) |
| WeatherCard         | 天气                | 否   | 固定日期及未来天气、空气质量、生活指数、城市天气             |
| LotteryCard         | 彩票                | 否   | 彩票开奖结果                                                 |
| MetalCard           | 贵金属              | 否   | 贵金属价格趋势                                               |
| ExchangeRateCard    | 汇率                | 否   | 汇率换算                                                     |
| HolidayCard         | 节假日              | 否   | 节假日信息                                                   |
| HanziCard           | 汉字                | 否   | 汉字的拼音、结构、笔顺、释义                                 |
| TrainScheduleCard   | 火车车次详情        | 否   | 按车次查询火车站点、时间信息                                 |
| TrainRouteCard      | 两地火车            | 否   | 两地之间火车车次、站点、票价信息                             |
| FlightRouteCard     | 两地航班            | 否   | 两地之间航班、时间、票价信息                                 |
| SportsMatchCard     | 篮球足球赛事        | 否   | 主要篮球足球赛事对战信息                                     |
| ActorWorksCard      | 明星作品/作品演员表 | 否   | 明星影视综/纪录片作品及作品演员表                            |
| TaxEnquiryCard      | 个人所得税          | 否   | 个人所得税税率查询                                           |
| MacroEconomyCard    | 各地GDP             | 否   | 各地区年度/季度GDP及增长数据                                 |
| ZipcodeCard         | 邮政编码            | 否   | 各地区邮政编码查询                                           |
| BasketballEventCard | NBA/CBA赛程         | 否   | 提供 NBA /CBA比赛赛程。                                      |
| BasketballMatchCard | NBA/CBA对战信息     | 否   | 提供 NBA /CBA对战信息。                                      |
| BasketballTeamCard  | NBA/CBA球队信息     | 否   | 提供 NBA/CBA 球队战绩、排名、阵容。                          |



### **ImageItem\-搜索图片结果详情**

> SearchType=image结果项



| **字段名**  | **类型**  | **必须** | **说明**                                                     |
| ----------- | --------- | -------- | ------------------------------------------------------------ |
| Id          | String    | 是       | 结果Id                                                       |
| SortId      | Number    | 是       | 排序Id                                                       |
| Title       | String    | 否       | 标题                                                         |
| SiteName    | String    | 否       | 站点名                                                       |
| Url         | String    | 否       | 落地页                                                       |
| PublishTime | String    | 否       | 发布时间，ISO时间格式<br><br>示例：2025\-05\-30T19:35:24+08:00 |
| Image       | ImageInfo | 是       | 图片详情                                                     |



### **ImageInfo\-图片结果项**

> 图片信息描述



| **字段名** | **类型** | **必须** | **说明**                                                     |
| ---------- | -------- | -------- | ------------------------------------------------------------ |
| Url        | String   | 是       | 图片链接                                                     |
| Width      | Number   | 否       | 宽                                                           |
| Height     | Number   | 否       | 高                                                           |
| Shape      | String   | 是       | 横长方形 判断：（宽\>高\*1.2）<br><br>竖长方形 判断：（宽<高\*1.2）<br><br>方形 判断：（其余情况） |
| BlurDes    | String   | 否       | 图片是否清晰，取值：<br><br><br>* 清晰<br><br>* 一般清晰<br><br>* 模糊 |
| Category   | String   | 否       | 图片所属分类（如：人物）                                     |
| Watermark  | String   | 否       | 图片是否有水印，取值：<br><br><br>* 1 \- 存在水印<br><br>* 0 \- 无水印 |



## **请求示例**


### web搜索

```JSON
{
    "Query": "最新的北京游玩攻略",
    "SearchType": "web",
    "Count": 10,
    "Filter": {
        "NeedContent":false,
        "NeedUrl":true
    },
    "TimeRange":"OneYear"
}
```



### image搜索

```JSON
{
    "Query": "郭德纲",
    "SearchType": "image",
    "Count": 2
}
```


## **响应示例**


### 正常请求示例

#### web搜索


```JSON
{
    "ResponseMetadata": {
        "RequestId": "202506191859387C810A0EB6D7ECB1BCCF",
        "Action": "WebSearch",
        "Version": "2025-01-01",
        "Service": "volc_torchlight_api",
        "Region": "cn-beijing"
    },
    "Result": {
        "ResultCount": 2,
        "WebResults": [
            {
                "Id": "28a0b62ff9ca9b5f-2e52de80bdcea1cb",
                "SortId": 1,
                "Title": "北京五日游攻略及路线，北京玩五天四晚大概多少钱?来到北京旅游必打卡的地方!",
                "SiteName": "搜狐网",
                "Url": "https://m.sohu.com/a/905840001_122260725/",
                "Snippet": "北京旅游攻略北京必打卡景点1. 故宫博物院：穿越600年皇权史，感受古代建筑与艺术的巅峰。2. 八达岭长城：攀登世界奇迹，俯瞰山峦壮阔，铭记历史印记。3. 天安门广场+升旗仪式：庄严的仪式感与历史厚重",
                "Summary": "北京旅游攻略北京必打卡景点1. 故宫博物院：穿越600年皇权史，感受古代建筑与艺术的巅峰。2. 八达岭长城：攀登世界奇迹，俯瞰山峦壮阔，铭记历史印记。3. 天安门广场+升旗仪式：庄严的仪式感与历史厚重感交织，必体验的爱国教育。4. 颐和园：皇家园林的湖光山色，漫步其间如入画卷。5. 什刹海+胡同：骑行或徒步探访老北京生活，品味烟火气。6. 奥林匹克公园：现代地标与体育精神的象征，适合拍照打卡。7. 南锣鼓巷/三里屯：感受新旧文化的碰撞，体验时尚与文艺。8. 清华/北大：外景打卡，感受学术殿堂的魅力。费用参考（人均约880元，具体视消费习惯调整）交通：往返北京的大交通（机票/高铁票自理）；市内交通含行程内用车（接机、景点接送等）。住宿：4晚北京市区中高档酒店餐饮：含部分正餐（特色餐自理，日均约100-200元）。门票：故宫（旺季60元）、长城（40元）、天坛（联票34元）、颐和园（30元）等，总约300元。导游服务费：丹丹全程陪同讲解（含行程规划、深度讲解、应急协助等）。",
                "Content": "北京五日游攻略及路线，北京玩五天四晚大概多少钱？来到北京旅游必打卡的地方！\n北京五日游攻略及路线：探索千年古都的魅力与活力 ——致谢本地导游丹丹的贴心安排\n北京，一座承载着千年历史与现代活力的城市，是中国的心脏与灵魂。从紫禁城的金碧辉煌到胡同里的烟火气息，从长城的雄伟壮阔到奥运场馆的现代风采，这里每一寸土地都镌刻着文明的印记。作为六朝古都，北京汇聚了中华文明的精华，同时以开放的姿态拥抱全球化，成为传统与现代交融的典范。无论是漫步在故宫的红墙之下，还是徜徉于三里屯的时尚街区，你都能感受到这座城市独特的魅力。此次北京之行，多亏了同事推荐的本地导游丹丹，她用丰富的经验与热情周到的服务，让我们的旅程更加顺畅、充满惊喜。感谢丹丹的贴心安排，让这段五日游成为难忘的回忆！联系方式15301330258\n北京旅游攻略\n五日游行程路线 首都北京高端品质游5天4晚\n第一天：抵达北京，开启探索之旅\n抵达北京：24小时接机/接站服务，专人接驳至酒店，办理入住手续。\n自由活动：晚上可自行前往王府井、南锣鼓巷、三里屯、牛街、簋街等商业街区。这些街区各具特色：王府井是传统商业街，汇聚老字号与时尚品牌；南锣鼓巷充满文艺气息，胡同里藏着咖啡馆与手作小店；簋街以夜市美食闻名，是品尝麻辣小龙虾与北京烤串的绝佳去处。\n第二天：历史与庄严的震撼体验\n升旗仪式：清晨前往天安门广场，见证五星红旗冉冉升起的庄严时刻，感受国家脉搏。\n天安门广场：漫步世界最大的城市广场，感受其宏伟与历史厚重感。\n毛主席纪念堂：瞻仰伟人风采，铭记历史。\n故宫博物院深度游：跟随丹丹的专业讲解，穿梭于太和殿、乾清宫等宫殿，探索明清皇室的权力中枢，感受紫禁城的恢弘与细节之美。\n天坛公园：游览古代帝王祈天祈谷的圣地，欣赏回音壁、祈年殿的精妙建筑，体会天人合一的哲学意境。 住宿：北京市区高品质酒店，含早餐。\n第三天：长城雄姿与老北京风情\n八达岭长城深度游：登临世界奇迹，体验“不到长城非好汉”的豪情。丹丹会分享长城的历史故事与建造智慧，让徒步之旅更富趣味。\n奥林匹克公园：参观鸟巢、水立方（外观），回顾2008年奥运盛况，感受体育与艺术的融合。\n什刹海+老北京胡同：骑行或漫步于什刹海畔，欣赏湖光与老宅的倒影；穿梭于胡同深处，探访四合院，感受老北京的市井生活。 用餐：含早、中餐，品尝地道北京家常菜。 住宿：北京市区。\n第四天：皇家园林与学府风采\n颐和园深度游：漫步昆明湖畔，登万寿山，赏长廊彩绘，领略“皇家园林博物馆”的绝美风光。\n园明园遗址公园：追忆昔日“万园之园”的辉煌，沉思历史沧桑。\n清华北大外景拍照：打卡中国顶尖学府，感受学术氛围与校园历史建筑。\n新前门大街+北京坊：逛前门老字号商铺，体验传统与现代商业的碰撞；北京坊是文艺新地标，适合打卡书店与创意店铺。 用餐：含早、中餐，品味老北京风味。 住宿：北京市区。\n第五天：自由时光与返程\n自由活动：可根据兴趣安排购物、探访小众景点或深度体验胡同文化。\n送站/送机：根据航班/车次时间，专人送您至机场或车站，结束愉快旅程。（建议预定中午12点后的航班/车次，避免时间紧张） 特别提醒：若需定制个性化行程或延长停留，可随时联系丹丹（电话：15301330258）。\n北京旅游攻略\n北京必打卡景点\n1. 故宫博物院：穿越600年皇权史，感受古代建筑与艺术的巅峰。\n2. 八达岭长城：攀登世界奇迹，俯瞰山峦壮阔，铭记历史印记。\n3. 天安门广场+升旗仪式：庄严的仪式感与历史厚重感交织，必体验的爱国教育。\n4. 颐和园：皇家园林的湖光山色，漫步其间如入画卷。\n5. 什刹海+胡同：骑行或徒步探访老北京生活，品味烟火气。\n6. 奥林匹克公园：现代地标与体育精神的象征，适合拍照打卡。\n7. 南锣鼓巷/三里屯：感受新旧文化的碰撞，体验时尚与文艺。\n8. 清华/北大：外景打卡，感受学术殿堂的魅力。\n费用参考（人均约880元，具体视消费习惯调整）\n交通：往返北京的大交通（机票/高铁票自理）；市内交通含行程内用车（接机、景点接送等）。\n住宿：4晚北京市区中高档酒店\n餐饮：含部分正餐（特色餐自理，日均约100-200元）。\n门票：故宫（旺季60元）、长城（40元）、天坛（联票34元）、颐和园（30元）等，总约300元。\n导游服务费：丹丹全程陪同讲解（含行程规划、深度讲解、应急协助等）。\n其他：自由活动交通、购物、小吃等弹性支出。\n品质承诺与实用Tips无强制消费：全程纯玩，拒绝隐形消费，安心畅游。导游优势：丹丹熟悉北京人文历史，讲解生动，能避坑、推\n品质承诺与实用Tips\n无强制消费：全程纯玩，拒绝隐形消费，安心畅游。\n导游优势：丹丹熟悉北京人文历史，讲解生动，能避坑、推荐地道美食，让旅行更省心。\n行程建议：夏季北京较热，建议携带防晒用品；故宫游览提前预约门票；长城徒步穿舒适鞋。\n必带物品：身份证、充电宝、常用药品、雨伞等。\n咨询方式：有任何需求或疑问，随时联系丹丹（15301330258，微信同号）。\n致谢与总结 这次北京五日游，从历史遗迹到现代地标，从皇家园林到胡同烟火，每一刻都令人难忘。丹丹的专业安排让我们避开了人潮拥挤的烦恼，深入体验了北京的精髓。她的耐心讲解、贴心提醒与灵活调整行程的能力，让整个旅程流畅且充满惊喜。无论是清晨的升旗仪式，还是长城上的夕阳，或是胡同里的家常菜，都成为记忆中的珍宝。若您计划来北京，强烈推荐联系丹丹，让您的旅行更舒心、更有温度！感谢丹丹的付出，期待下次再聚北京！\n联系方式 导游丹丹：15301330258（微信同号） 欢迎随时咨询行程定制、景点攻略或本地推荐！\n——您的北京之旅，定不负期待！\n编辑：小夏\n",
                "PublishTime": "2025-06-19T15:10:00+08:00",
                "LogoUrl": "https://p3-search.byteimg.com/img/labis/a137863e023678c3c73533c4ac283f7d~noop.jpeg",
                "RankScore": 0.9513234279682939,
                "AuthInfoDes": "正常权威",
                "AuthInfoLevel": 2,
                "RuyiInfo": null
            },
            {
                "Id": "36b94b5dc3d137ba-23d38a2a02d6a399",
                "SortId": 2,
                "Title": "北京游玩全攻略，不踩雷-手机网易网",
                "SiteName": "网易手机网",
                "Url": "http://m.163.com/dy/article/JRNSF13A05569KNM.html",
                "Snippet": "北京游玩全攻略，不踩雷北京游玩全攻略，不踩雷我们刚结束北京七日深度游，全程人均花费仅1500元。特别感谢朋友推荐的当地导游小陈，提供专业细致的管家式服务。从行程规划到门票、住宿、交通、餐饮的全套安排都",
                "Summary": "北京游玩全攻略，不踩雷北京游玩全攻略，不踩雷我们刚结束北京七日深度游，全程人均花费仅1500元。特别感谢朋友推荐的当地导游小陈，提供专业细致的管家式服务。从行程规划到门票、住宿、交通、餐饮的全套安排都无需操心，全程无隐形消费，更可根据需求私人定制行程。贴心安排亮点：√出发前管家会发送注意事项清单√全程专车接送服务√自由行模式+全程随行讲解√所有景点提前预约免排队北京7日游精华路线：DAY1：抵京→前门大街美食→天安门降旗仪式DAY2：国家博物馆（地铁1号线天安门东D口直达）→三里屯购物DAY3：慕田峪长城（前门集散中心直达车免换乘）→王府井夜游DAY4：环球影城全景体验（地铁1号线B口直达）DAY5：故宫深度游（金鱼胡同C口东华门捷径）→国贸CBD观景DAY6：科技馆探索→奥体中心三件套（鸟巢/水立方/新奥商圈）DAY7：军事博物馆→返程京城美食地图：【经典必吃】烤鸭：金山城·湖畔人家北京游玩全攻略，不踩雷铜锅涮肉：南门涮肉、又一号炸酱面：方砖厂69号【特色小吃】牛街满记烧饼/天桥郭记灌肠/门钉肉饼【风味餐厅】簋街必吃：牛串门/小河盐帮蒜香小龙虾异国料理：乐园夜市场韩餐/铃木食堂日料住宿优选区域：▶️核心区：前门/西单（近天安门/商业区）▶️文化区：什刹海四合院/五道口高校圈▶️交通枢纽：西直门（近北京北站/动物园）▶️商务区：国贸CBD（高端酒店聚集地）行程贴心提示：1.环球影城建议避开周末2.故宫/国博需提前7天预约3.长城穿搭以运动装备为佳4.科技馆适合亲子家庭深度体验全程管家小陈提供24小时咨询服务（175-6194-9968），包含特色餐饮、景区讲解、交通接驳等全方位服务保障。这种全程无忧的旅行方式特别适合初次来京或带家人出游的朋友，既能深度感受京城魅力，又无需操心行程琐事。",
                "Content": "北京游玩全攻略，不踩雷北京游玩全攻略，不踩雷我们刚结束北京七日深度游，全程人均花费仅1500元。特别感谢朋友推荐的当地导游小陈，提供专业细致的管家式服务。从行程规划到门票、住宿、交通、餐饮的全套安排都无需操心，全程无隐形消费，更可根据需求私人定制行程。贴心安排亮点：√出发前管家会发送注意事项清单√全程专车接送服务√自由行模式+全程随行讲解√所有景点提前预约免排队北京7日游精华路线：DAY1：抵京→前门大街美食→天安门降旗仪式DAY2：国家博物馆（地铁1号线天安门东D口直达）→三里屯购物DAY3：慕田峪长城（前门集散中心直达车免换乘）→王府井夜游DAY4：环球影城全景体验（地铁1号线B口直达）DAY5：故宫深度游（金鱼胡同C口东华门捷径）→国贸CBD观景DAY6：科技馆探索→奥体中心三件套（鸟巢/水立方/新奥商圈）DAY7：军事博物馆→返程京城美食地图：【经典必吃】烤鸭：金山城·湖畔人家北京游玩全攻略，不踩雷铜锅涮肉：南门涮肉、又一号炸酱面：方砖厂69号【特色小吃】牛街满记烧饼/天桥郭记灌肠/门钉肉饼【风味餐厅】簋街必吃：牛串门/小河盐帮蒜香小龙虾异国料理：乐园夜市场韩餐/铃木食堂日料住宿优选区域：▶️核心区：前门/西单（近天安门/商业区）▶️文化区：什刹海四合院/五道口高校圈▶️交通枢纽：西直门（近北京北站/动物园）▶️商务区：国贸CBD（高端酒店聚集地）行程贴心提示：1.环球影城建议避开周末2.故宫/国博需提前7天预约3.长城穿搭以运动装备为佳4.科技馆适合亲子家庭深度体验全程管家小陈提供24小时咨询服务（175-6194-9968），包含特色餐饮、景区讲解、交通接驳等全方位服务保障。这种全程无忧的旅行方式特别适合初次来京或带家人出游的朋友，既能深度感受京城魅力，又无需操心行程琐事。",
                "PublishTime": "2025-03-28T10:07:00+08:00",
                "LogoUrl": "",
                "RankScore": 0.8567117940706734,
                "AuthInfoDes": "正常权威",
                "AuthInfoLevel": 2,
                "RuyiInfo": null
            }
        ],
        "SearchContext": {
            "OriginQuery": "北京最新游玩攻略",
            "SearchType": "web"
        },
        "TimeCost": 372,
        "LogId": "202506191859387C810A0EB6D7ECB1BCCF",
        "CardResults": null
    }
}
```



#### image搜索

```JSON
{
    "ResponseMetadata": {
        "RequestId": "20251125192459969354E7592A3DC606DF",
        "Action": "",
        "Version": "",
        "Service": "",
        "Region": ""
    },
    "Result": {
        "ResultCount": 5,
        "WebResults": null,
        "SearchContext": {
            "OriginQuery": "北京天气",
            "SearchType": "image"
        },
        "TimeCost": 358,
        "LogId": "20251125192459969354E7592A3DC606DF",
        "Choices": null,
        "Usage": null,
        "ImageResults": [
            {
                "Id": "4e549b1f60f2b45c-018bd035d70d36f6",
                "SortId": 1,
                "Title": "抓住周末尾巴，今日北京天气晴间多云宜出行",
                "SiteName": "今日头条",
                "Url": "",
                "PublishTime": "1970-01-01T08:00:00+08:00",
                "Image": {
                    "Url": "https://p3-volcsearch-sign.byteimg.com/tos-cn-i-xstd03g9pf/f31d38ab5da145368541dbb61466a711~tplv-obj.jpeg?lk3s=7acb411c&scene=volc_search&x-expires=1827141899&x-signature=N41QvghenmZkRE%2FOxVcG5mY2QhI%3D",
                    "Width": 900,
                    "Height": 506,
                    "Shape": "横长方形"
                },
                "RankScore": 0.955078125
            },
            {
                "Id": "60edfaca4f4962c3-11040179c087dd77",
                "SortId": 3,
                "Title": "北京迎来雷阵雨天气",
                "SiteName": "今日头条",
                "Url": "",
                "PublishTime": "1970-01-01T08:00:00+08:00",
                "Image": {
                    "Url": "https://p26-volcsearch-sign.byteimg.com/tos-cn-i-xstd03g9pf/f56a437d929543639ae85628622d741b~tplv-obj.jpeg?lk3s=7acb411c&scene=volc_search&x-expires=1827141899&x-signature=YIc7rZGoeJlSRZWpfm%2F%2BwnucZto%3D",
                    "Width": 1000,
                    "Height": 666,
                    "Shape": "横长方形"
                },
                "RankScore": 0.884619140625
            },
            {
                "Id": "762cd61dedb754fa-30ce250d2175a7e8",
                "SortId": 5,
                "Title": "北京天气预报",
                "SiteName": "东方天气",
                "Url": "http://tianqi.eastday.com/news/61004.html",
                "PublishTime": "1970-01-01T08:00:00+08:00",
                "Image": {
                    "Url": "https://p26-volcsearch-sign.byteimg.com/tos-cn-i-xstd03g9pf/da88013a30fd4f5a82fe4052abaf1073~tplv-obj.jpeg?lk3s=7acb411c&scene=volc_search&x-expires=1827141899&x-signature=xam4C%2BYvZNlDc7YhLfeV3oAxatw%3D",
                    "Width": 600,
                    "Height": 391,
                    "Shape": "横长方形"
                },
                "RankScore": 0.761328125
            }
        ],
        "CardResults": null
    }
}
```


### 错误请求返回示例


```JSON
{
    "ResponseMetadata": {
        "RequestId": "202505231206578F7BD0BCD73AF8703C1E",
        "Action": "WebSearch",
        "Version": "2025-01-01",
        "Service": "volc_torchlight_api",
        "Region": "cn-beijing",
        "Error": {
            "CodeN": 10400, // 该字段为错误码
            "Code": "10400",
            "Message": "query or search type is empty"
        }
    },
    "Result": null
}
```



---




# 错误处理


|**错误码** |报错响应 |说明 |**建议检查/处理方式** |
|---|---|---|---|
|10400 |ParamError |通用参数错误 |检查请求结构体，一般是字段类型错误 |
|10401 |InvalidTopToken |无效的TOP网关Token |检查请求Token是否正确 |
|10402 |InvalidSearchType |非法的搜索类型 |检查search_type是否传参错误；检查是否已开通search_type |
|10403 |InvalidAccountId |权限错误 |检查账号是否已经开通对应[搜索服务](https://console.volcengine.com/search-infinity/web-search) |
|10406 |FreeQuotaExhausted |免费搜索额度用尽 |在[控制台](https://console.volcengine.com/search-infinity/web-search)确认是否开通付费调用 |
|10409 |SearchPackageModeUnsupported |订阅套餐不支持当前搜索类型 |当前使用订阅套餐的API Key调用了非 Custom版web搜索，查看[详细说明](https://docs.volcengine.com/docs/87772/2272951?lang=zh#LWSyNe7y)并检查使用Key是否正确 |
|10410 |SearchPackageUnavailable |无可用订阅套餐 |可能使用了未开通/已到期的订阅套餐API Key，检查套餐[开通状态](https://console.volcengine.com/search-infinity/web-search?tab=subscription_plan) |
|10412 |SearchPackageQuotaExhausted |订阅套餐剩余额度不足 |在[控制台](https://console.volcengine.com/search-infinity/web-search?tab=subscription_plan)查看订阅套餐剩余额度，并进行套餐升配或切换[按量后付费的API Key](https://console.volcengine.com/search-infinity/api-key)继续调用 |
|10500 |InnerError |默认内部错误 |兜底的服务端错误码，一般情况可以重试解决 |
|700429 |FreeRateLimitExceeded |并发量超过QPS限流 |控制搜索每秒并发量（初始默认QPS 5，可在[控制台](https://console.volcengine.com/search-infinity/web-search)的服务卡片查看当前QPS限制）<span>![图片](https://portal.volccdn.com/obj/volcfe/cloud-universal-doc/upload_01a89d348415ba0a15ee4ae0b669d6f7.png) </span>我们支持按照实际用量合理扩容，可提交[工单](https://console.volcengine.com/workorder/create)申请并说明使用规模和调用场景提供扩容评估） |