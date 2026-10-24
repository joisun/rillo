# 关系与时间数据

实现仅登记边的SQLite store，单一主会话、幂等、拒绝自关联和环。SessionBrowser融合原生与登记关系，扩展读取、children、timeline、按时间定位。Codex返回原生parent/fork来源，分段活动、分页覆盖、时间精度，排除继承历史的活动。测试以fake native client覆盖，无真实模型轮次。
