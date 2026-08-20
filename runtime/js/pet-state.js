/**
 * pet-state.js — 动画配置：状态/活动/互动/彩蛋 → 动画文件
 * 全局命名空间 window.PetState
 */
window.PetState = {
  // 状态 → 动画数组（同类多动画随机，播完自动轮换）
  // IDLE 特例：主状态固定播放 idle_breathe，其余由 IDLE_EGG_ANIMS 定时彩蛋触发
  STATE_TO_ANIM: {
    IDLE: ['assets/idle_breathe.webm'],   // 主动画（待机固定）
    THINKING: [
      'assets/think_mutter.webm',
      'assets/think_cube.webm',
      'assets/think_nap.webm',
      'assets/think_yawn.webm',
    ],
    WORKING: 'dynamic',
    WAITING: [
      'assets/idle_float.webm',
      'assets/idle_breathe.webm',
    ],
    SUCCESS: [
      'assets/success_dance.webm',
      'assets/success_maid.webm',
      'assets/success_swing.webm',
      'assets/success_violin.webm',
    ],
    // ERROR 为一次性闪现动画池（收到 error 信号随机抽一个）
    ERROR: [
      'assets/error_frustrated.webm',

    ],
    DISCONNECTED: [
      'assets/idle_breathe.webm',
    ],
  },

  // WORKING 活动类型细分（播完自动轮换）
  WORK_ACTIVITY: {
    searching: ['assets/work_search.webm'],
    editing:   ['assets/work_edit.webm'],
    testing:   ['assets/work_test.webm'],
    commanding:['assets/work_cmd.webm'],
    working:   ['assets/work_default.webm'],
    default:   ['assets/work.webm'],
  },

  // IDLE 主动画
  IDLE_MAIN: 'assets/idle_breathe.webm',
  // 拖拽悬空反馈动画
  DRAG_ANIM: 'assets/drag_hover.webm',

  // 点击互动动画（点击随机触发）——仅保留原互动 + 情绪反馈
  INTERACT_ANIMS: [
    'assets/interact_surprise.webm',
    'assets/interact_poke.webm',
    'assets/interact_jump.webm',
    'assets/interact_balloon.webm',
    'assets/click_tsundere.webm',  // 傲娇生气
    'assets/click_shy.webm',       // 害羞惊讶
    'assets/click_happy.webm',     // 开心跃动
  ],

  // 空闲 60 秒必触发彩蛋集合（之前未分类的动画统一放这里）
  IDLE_EGG_ANIMS: [
    'assets/error_leaves.webm',
    'assets/error_stretch.webm',
    'assets/click_moon.webm',      // 中秋赏月吃月饼
    'assets/click_snack.webm',     // 偷吃零食被抓住
    'assets/click_icecream.webm',  // 吃冰淇淋融化
    'assets/click_rice.webm',      // 吃白饭
    'assets/click_gobble.webm',    // 大口吃零食
    'assets/click_toycar.webm',    // 原地蹲下玩玩具汽车
    'assets/click_squash.webm',    // 原地重力下蹲压缩
    'assets/click_animals.webm',   // 动物环绕
    'assets/click_mirror.webm',    // 照镜子
    'assets/click_tail.webm',      // 鲸鱼尾巴拍地
    'assets/click_whale.webm',     // 蓝鲸现世
    'assets/click_crab.webm',      // 螃蟹走路
    'assets/click_bubbles.webm',   // 鲸鱼吐泡泡
    'assets/click_berry.webm',     // 整体换装试色
    'assets/click_bow.webm',       // 女仆屈膝礼仪
    'assets/click_rotate.webm',    // 旋转展示
  ],

  // 饮食彩蛋（特定时间触发，仅空闲时）
  MEAL_EVENTS: [
    { name: 'breakfast', startHour: 7,  endHour: 9,   anim: 'assets/eat_breakfast.webm' },
    { name: 'lunch',     startHour: 11, endHour: 13,  anim: 'assets/eat_lunch.webm' },
    { name: 'dinner',    startHour: 17, endHour: 19,  anim: 'assets/eat_dinner.webm' },
  ],

  // 长时间 WORKING → 吃 Token
  LONG_WORK_ANIM: 'assets/eat_token.webm',

  // 兜底
  FALLBACK: 'assets/idle_breathe.webm',
}
