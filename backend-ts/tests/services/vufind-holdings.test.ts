import { describe, expect, it } from 'vitest';
import { parseHoldingsFromHtml } from '../../src/services/vufind-service.js';

/**
 * 依据 vufind 详情页真实结构精简的样例：
 * - 2 个 location-item 馆藏地；
 * - 桌面端 <tr typeof="Offer"> 复本行 + 移动端 <div typeof="Offer" class="row"> 重复行（不应重复计入）；
 * - 状态列含隐藏的「预计归还时间」节点与脚本（应只取首个可见标签）。
 */
const SAMPLE_HTML = `
<div class="branch">
  <h2 style="color: #0a4689;">所属馆:上海图书馆（淮海路馆）</h2>
  <div class="location-item pl-5">
    <h3>
      上海图书馆保存本书库</h3>
    <div class="visible-lg-block visible-md-block">
      <meta property="serialNumber" content="54121111408051">
      <table class="table table-striped">
        <tbody><tr class="holding-unavailable" style="font-weight: bold">
          <td>索书号</td><td>条码号</td><td>借阅类型</td><td>当前状态</td>
        </tr>
        <tr vocab="http://schema.org/" typeof="Offer" class="holding-available">
          <td><span class="holding-field callnumber">K835.465.6/2212-11</span></td>
          <td><span class="holding-field barcode">54121111408051</span></td>
          <td><span class="holding-field loanType">保存资料</span></td>
          <td><span class="holding-field availability">
            <span class="text-success">已归还<link property="availability" href="http://schema.org/InStock"></span>
            <a class="item-return-date"><p style="display: none;">预计归还时间: <span>x</span></p></a>
            <script>$("x").click(function(){})</script>
          </span></td>
        </tr>
        </tbody></table>
    </div>
    <div class="visible-sm-block visible-xs-block">
      <div vocab="http://schema.org/" typeof="Offer" class="row holding-available">
        <div class="col-12"><span class="holding-field barcode">54121111408051</span></div>
      </div>
    </div>
  </div>
  <div class="location-item pl-5">
    <h3>
      上海图书馆( 淮海路馆 ) 中文书刊外借室（2楼普通借阅区）</h3>
    <div class="visible-lg-block visible-md-block">
      <table class="table table-striped">
        <tbody>
        <tr vocab="http://schema.org/" typeof="Offer" class="holding-unavailable">
          <td><span class="holding-field callnumber">K835.465.6/2212-11</span></td>
          <td><span class="holding-field barcode">54121111844368</span></td>
          <td><span class="holding-field loanType">普通外借资料</span></td>
          <td><span class="holding-field availability">
            <span class="text-danger">已借出</span>
            <a class="item-return-date"><p style="display: none;">预计归还时间: <span>y</span></p></a>
            <script>const itemId = $(x).data('itemid');</script>
          </span></td>
        </tr>
        </tbody></table>
    </div>
  </div>
</div>`;

describe('parseHoldingsFromHtml', () => {
  it('按馆藏地分组解析复本，条码去重且不受移动端重复 DOM 影响', () => {
    const groups = parseHoldingsFromHtml(SAMPLE_HTML);

    expect(groups.map((g) => g.location)).toEqual([
      '上海图书馆保存本书库',
      '上海图书馆( 淮海路馆 ) 中文书刊外借室（2楼普通借阅区）',
    ]);
    expect(groups.map((g) => g.items)).toEqual([
      [
        {
          callnumber: 'K835.465.6/2212-11',
          barcode: '54121111408051',
          loanType: '保存资料',
          status: '已归还',
        },
      ],
      [
        {
          callnumber: 'K835.465.6/2212-11',
          barcode: '54121111844368',
          loanType: '普通外借资料',
          status: '已借出',
        },
      ],
    ]);
  });

  it('无馆藏块时返回空数组', () => {
    expect(parseHoldingsFromHtml('<html><body>没有馆藏信息</body></html>')).toEqual([]);
  });
});
