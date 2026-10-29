export function rendererErrorPresentation(error) {
  return {
    title: 'Timeline 暂时无法显示',
    message: '任务数据仍由 daemon 保存。请刷新页面重试；若问题持续，请检查 daemon 日志。',
    logMessage: error instanceof Error && error.message
      ? error.message
      : 'Unknown renderer error',
  }
}
