# 상세 안내

[README](../README.md)에서 뺀 도구별 입력, 옵션과 제한 사항입니다.


총 65개이며, 읽기 22개와 쓰기 43개입니다. 표의 쓰기 도구는 `writes_enabled: true`일 때만 표시됩니다. 읽기 도구도 브라우저 탭을 열거나 결과 파일을 저장할 수 있습니다. 파일 출력·브라우저 조작 도구는 MCP의 `readOnlyHint`를 `false`로, 순수 조회 도구는 `true`로 전달합니다. 실제 실행 승인은 클라이언트의 정책을 따릅니다.

| 도구 | 하는 일 | 구분 |
|---|---|---|
| `connection_check` | 전용 브라우저, Looker Studio 로그인, ADC와 현재 설정 확인 | 읽기 |
| `report_list` | 접근 가능한 보고서 목록과 이름 검색 | 읽기 |
| `report_create` | BigQuery·Google Sheets 소스를 연결한 새 보고서 생성 | 쓰기 |
| `report_copy` | 보고서 복사와 선택한 데이터 연결 교체 | 쓰기 |
| `report_rename` | 보고서 제목 변경 | 쓰기 |
| `report_delete` | `confirm_name`이 현재 제목과 같으면 보고서를 휴지통으로 이동 | 쓰기 |
| `report_link_build` | BigQuery·Google Sheets 연결을 지정한 보고서 생성 URL 작성 | 읽기 |
| `page_list` | 페이지 이름, ID, 순서와 보기 화면 표시 여부 조회 | 읽기 |
| `page_add` | 빈 페이지 추가 | 쓰기 |
| `page_rename` | 페이지 이름 변경 | 쓰기 |
| `page_edit` | 페이지 복제, 삭제, 순서와 보기 화면 표시 여부 변경 | 쓰기 |
| `page_settings_update` | 페이지·보고서의 기본 데이터, 기간, 필터와 페이지 배경·크기 설정 | 쓰기 |
| `datasource_list` | 데이터 연결, 별칭, 사용처와 선택적으로 필드 조회 | 읽기 |
| `connector_list` | 생성 가능한 커넥터와 연결 방식·미지원 범위 조회 | 읽기 |
| `datasource_add` | BigQuery 테이블·뷰·사용자 SQL 또는 Google Sheets 연결 | 쓰기 |
| `datasource_remove` | 사용처를 확인한 뒤 보고서에서 데이터 소스 제거 | 쓰기 |
| `datasource_refresh` | 연결된 BigQuery·Google Sheets·GA4의 열 변경을 필드 목록에 반영 | 쓰기 |
| `datasource_query` | 연결된 데이터 소스의 측정기준·지표 값을 차트 저장 없이 조회 | 읽기 |
| `datasource_update` | 소스 이름, SQL, 인증 방식, 갱신 주기와 재사용 여부 변경 | 쓰기 |
| `field_update` | 필드 이름, 데이터 유형과 기본 집계 변경 | 쓰기 |
| `calculated_field_add` | 수식을 검증한 뒤 계산 필드 추가 | 쓰기 |
| `group_field_add` | 조건에 따라 값을 묶는 그룹 필드 추가 | 쓰기 |
| `bin_field_add` | 숫자를 일정한 간격으로 나누는 구간 필드 추가 | 쓰기 |
| `parameter_add` | 유형, 기본값과 허용값을 가진 매개변수 추가 | 쓰기 |
| `blend_create` | 2~5개 데이터 소스의 필드를 조인한 혼합 데이터 생성 | 쓰기 |
| `report_filter_edit` | 저장된 필터 수정, 이름 변경, 복제와 삭제 | 쓰기 |
| `chart_add` | 유형, 필드, 집계, 위치와 표시 옵션을 지정해 차트 추가 | 쓰기 |
| `community_viz_add` | 갤러리 이름이나 매니페스트로 커뮤니티 시각화 추가 | 쓰기 |
| `control_add` | 필터, 기간, 차원·매개변수 선택기와 버튼 추가 | 쓰기 |
| `component_template_list` | 준비된 디자인을 이름·용도·검색어로 찾고 검증 상태 조회 | 읽기 |
| `component_template_inspect` | 디자인의 데이터 역할·자료형·제목·기간·테마 조건 조회 | 읽기 |
| `component_template_plan` | 분석 목적에 맞는 공통 구조 추천·필드 검증·생성/수정 실행 계획 | 읽기 |
| `component_template_add` | 고객 필드를 연결해 검증된 디자인을 보고서에 추가 | 쓰기 |
| `component_template_update` | 기존 공통 차트·섹션·메뉴를 전체 구성 입력으로 수정 | 쓰기 |
| `component_template_patch` | 같은 소스의 측정항목만 바꾸고 기존 설정 유지 | 쓰기 |
| `component_page_outline` | 고른 지표와 분류의 실제 값 개수를 읽어 페이지의 분석 영역 구성을 제안 | 읽기 |
| `component_page_add` | 빈 페이지에 차트·요약 섹션·분석 영역·사이드바를 자동 배치하고 크기 계산 | 쓰기 |
| `component_report_add` | 여러 페이지를 만들어 메뉴 구역으로 묶고 페이지마다 분석 영역을 제안·구성 | 쓰기 |
| `component_list` | 페이지와 보고서 공통 요소의 ID, 종류와 위치 조회 | 읽기 |
| `component_inspect` | 요소의 데이터, 필드, 정렬, 필터와 스타일 상세 조회 | 읽기 |
| `component_delete` | ID로 지정한 요소와 그 조건부 서식 삭제 | 쓰기 |
| `component_update` | 요소의 설정, 위치, 크기, 앞뒤 순서와 보고서 공통 여부 변경 | 쓰기 |
| `component_duplicate` | 설정을 보존해 요소 복제 | 쓰기 |
| `component_arrange` | 요소 정렬, 간격 맞춤, 그룹과 그룹 해제 | 쓰기 |
| `text_add` | 서식 있는 텍스트 추가 | 쓰기 |
| `shape_add` | 도형 추가 | 쓰기 |
| `line_add` | 선과 화살표 추가 | 쓰기 |
| `image_add` | URL, 파일 또는 데이터 URI의 이미지 추가 | 쓰기 |
| `embed_add` | 외부 콘텐츠 삽입 | 쓰기 |
| `theme_update` | 기본 테마, 색·글꼴, 탐색 메뉴, 레이아웃과 캔버스 변경 | 쓰기 |
| `report_check` | 차트의 데이터 오류, 빈 결과, 잘못된 필드와 동의 필요 여부 확인 | 읽기 |
| `report_render` | 서버에서 페이지를 PDF와 선택적으로 PNG로 렌더 | 읽기 |
| `report_data_refresh` | 보고서의 데이터 새로고침 요청; 차트·열 구조·게시 상태 유지 | 쓰기 |
| `report_show` | 브라우저에서 페이지를 열고 선택적으로 화면 캡처 | 읽기 |
| `version_list` | 보고서의 저장된 버전 목록 조회 | 읽기 |
| `version_restore` | 선택한 보고서 버전 복원 | 쓰기 |
| `report_spec_export` | 보고서를 이식 가능한 JSON 명세로 내보내기 | 읽기 |
| `report_spec_apply` | JSON 명세로 새 보고서 생성 또는 기존 보고서의 빠진 항목 추가 | 쓰기 |
| `batch_apply` | 보고서 편집 도구 목록을 사전 검사하고 순서대로 실행 | 쓰기 |
| `bq_dataset_list` | 프로젝트의 BigQuery 데이터셋 조회 | 읽기 |
| `bq_table_list` | 데이터셋의 테이블과 뷰 조회 | 읽기 |
| `bq_table_describe` | 스키마, 테이블 정보와 뷰 SQL 조회 | 읽기 |
| `bq_query_run` | 읽기 전용 SELECT·WITH 실행 또는 쿼리 검증 | 읽기 |
| `bq_view_create` | 검증한 SELECT를 BigQuery 뷰로 저장·교체 | 쓰기 |
| `bq_view_delete` | 이 서버가 만든 것으로 표시된 BigQuery 뷰 삭제 | 쓰기 |

차트 종류와 옵션은 별도 도구 없이 `chart_add`와 `component_update`를 확장합니다. 표, 스코어카드, 시계열, 막대, 원형, 영역, 피벗, 지도, 게이지, 산키 등을 지원하며, 유형별 필드 수와 Setup 슬롯은 도구 입력 설명에 표시됩니다. 정렬, 기간 비교, 필터, 참조선·참조영역, 조건부 서식과 시리즈 설정도 같은 도구로 지정합니다. 스타일 키는 편집기의 표시 이름을 사용하며 `component_inspect`로 현재 값을 확인할 수 있습니다.

저장된 디자인을 사용하려면 서버 설정의 `component_library`에 운영자가 관리하는 라이브러리 폴더를 지정합니다. 생략하면 설정 폴더의 `components/`를 읽습니다. 폴더에는 `catalog.json`, `validation.json`, `recipes/<template_id>.json`이 있어야 합니다. 클라이언트가 파일 경로를 넘기지 않으며, 공개 조회 응답에는 원본 보고서·소스 식별자와 native 정의를 포함하지 않습니다.

`component_template_list` → `component_template_inspect` → 대상 데이터 소스의 필드 확인 → `component_template_add` 순서로 사용합니다. `bindings`에 역할별 필드를 연결하고, 비교 카드에는 날짜 필드와 `date_range`를 줍니다. `SUM(...)`처럼 자체 집계하는 계산 필드에는 `aggregation`을 생략합니다. `preview: true`는 저장 전에 입력을 검사합니다. 원본의 고객별 필터는 복사하지 않으며, 조건 반영 필드가 필요한 역할을 상세 응답에서 알립니다. 미검증·미지원 디자인은 조회할 수 있지만 추가는 거부합니다.

라이브러리 원본 디자인과 별도로 KPI·시간 추이·표를 포함한 10개 공통 구조를 제공합니다. `component_template_list`에 `verified_only: false`를 주면 찾을 수 있으며, 상태는 `supported_pending_review`입니다. 저장된 디자인 라이브러리와는 별개의 구조입니다. 이 경로는 설치된 레시피 없이 기존 `chart_add`를 사용합니다.

공통 구조의 `bindings`는 `metric`(측정값), `date`(날짜), `dimension`(표의 분류) 역할입니다. `texts.title`로 제목, `size: {width, height}`로 생성 영역을 지정합니다. `common_options`에는 KPI의 `comparison`·`decimal_precision`, 추이의 `average_line`, 표의 `percent_of_total`을 각각 줄 수 있습니다. `date_range`에는 날짜 역할이 필요하며 기간 비교에는 둘 다 필수입니다. 비중은 현재 필터를 적용한 차트 합계가 분모이고, 평균선은 표시된 날짜별 지표 값의 평균입니다.

색상·글꼴·배경은 `theme_update`로 정한 보고서 테마에서 상속합니다. 원본에서 추출한 글자 위계·정렬·행 간격을 유지하면서 지정 영역에 맞춰 추이 내부 영역과 표 열 너비·페이지 행 수를 정합니다. KPI는 제목과 지표명을 중복 표시하지 않으며, 소수 자릿수는 `decimal_precision`을 지정한 경우에만 바꿉니다. 추이는 긴 값 라벨을 숨기고 툴팁으로 값을 확인할 수 있게 합니다. 이 배치는  브라우저 창 크기가 바뀔 때 자동 재배치하는 기능은 아닙니다. 기존 원본 디자인 경로에는 `size`와 `common_options`를 적용하지 않습니다. 일반 `chart_add`/`component_update`에서 지원하는 공통 차트 유형에 `project_theme: true`를 명시하면 프로젝트 테마 상속을 적용할 수도 있습니다. 계산·단위·조건부 색 등의 의미 설정은 유지합니다.

추가 공통 구조의 역할과 옵션은 다음과 같습니다. 모든 집계는 각 지표 역할의 `{field, aggregation?, label?}`에서 지정하며, 자체 집계 필드는 `aggregation`을 생략합니다.

| 공통 ID | 필수 역할 | 선택 역할·옵션 |
|---|---|---|
| `common-category-bars` | `dimension`, `metric` | `breakdown`, `date`; `orientation`, `stack` |
| `common-radial-share` | `dimension`, `metric` | `date`; `donut` |
| `common-area-trend` | `date`, `metric` | `breakdown`; `stack` |
| `common-category-line` | `dimension`, `metric` | `breakdown`, `date` |
| `common-mixed-series` | `dimension`, `metric`, `secondary_metric` | `date`; `secondary_axis` |
| `common-pivot-table` | `row`, `column`, `metric` | `date`; `heatmap` |
| `common-xy-scatter` | `dimension`, `x_metric`, `y_metric` | `size_metric`, `date` |

`stack`은 `none`/`absolute`/`percent`이며 누적에는 `breakdown`이 필요합니다. 100% 누적의 분모는 각 범주의 계열 합계입니다. 원형·도넛의 비중은 현재 차트에 포함된 값의 합계 기준입니다. 복합 차트는 첫 지표를 막대, 둘째 지표를 선으로 표시하며 단위가 다르면 `secondary_axis: true`를 명시합니다. 산점은 `size_metric`이 있으면 버블로 표시합니다. 범주축 선의 순서는 기본 차트 정렬을 따르므로 단계처럼 순서가 중요한 분류는 기존 정렬 기능으로 지정해야 합니다. 지도·외부 시각화는 이 10종에 포함하지 않습니다.

`common-overview-section`은 `metric`, `date`, `dimension`을 받아 제목·설명·배경·기간/분류 선택기와 KPI·추이·비중표를 한 그룹으로 만듭니다. `texts.title`, `texts.description`, `section_options: {date_control, dimension_control, decimal_precision?}`를 사용합니다. 기간 선택기가 있으면 `date_range`는 그 선택기의 초기 기간에만 적용하고 차트는 자동 기간을 따릅니다. 폭 1,000px 이상은 KPI·추이를 나란히, 600~999px는 세로로 배치합니다. 같은 소스와 지표 정의를 공유하며 페이지 전체의 날짜·필터 설정은 바꾸지 않습니다.

`common-navbar`는 데이터 없이 `bindings: {}`와 `navigation: {items: [{label, page}]}`로 같은 보고서의 페이지 메뉴를 만듭니다. `navigation.layout: "vertical"`이면 왼쪽 사이드바로 배치하고, 생략하거나 `"horizontal"`이면 상단 가로 메뉴로 배치합니다. 세로 기본 크기는 240×720px이며 `size`로 변경할 수 있습니다. `texts.title`은 브랜드명이며 현재 페이지를 강조합니다. 대상 페이지는 먼저 만들어야 합니다. 외부 링크·공유 동작·전체 페이지 메뉴 자동 동기화·접기 메뉴는 지원하지 않습니다.

두 조합은 기존 도구로 전체 구성을 저장 없이 검증한 후 새 요소와 그룹을 한 번의 페이지 저장으로 추가합니다. `preview: true`는 실제 요소를 만들지 않습니다. 차트는 프로젝트 테마를 상속하고, 배경·컨트롤·메뉴의 명시 색은 생성 당시 테마 값입니다. 테마가 바뀐 뒤 해당 정적 요소를 자동으로 다시 칠하는 기능은 아직 없습니다. `report_spec_export/apply`는 `pages[].groups`로 요소 그룹·중첩 관계·필터 상속 범위를 보존하고, 새로 생성한 요소 ID에 다시 연결합니다. 날짜 선택기의 고정·상대·자동 초기 기간도 함께 보존합니다. 프로젝트 테마를 상속하는 차트와 투명 격자·배경 설정도 내보내고 복원합니다. 그룹 자체에 별도 데이터 소스·계산 필드·고정 필터가 붙어 있는 경우는 아직 지원하지 않으며, 해당 조건을 버리지 않고 내보내기를 거부합니다. 기존 대상의 그룹과 충돌하거나 구성원 연결이 불명확하면 기존 그룹을 바꾸지 않습니다. 그룹 없는 기존 V1 스펙도 그대로 사용할 수 있습니다. `report_check`는 그룹 컨트롤의 선택 상태를 평가하지 않으므로 필터의 실제 적용과 섹션 간 격리는 보고서 화면에서 확인해야 합니다.

`component_template_update`는 기존 공통 차트의 `component_id` 또는 섹션·메뉴의 `group_id`를 지정해 해당 대상만 다시 구성합니다. 데이터 소스·필드·집계·기간·크기 및 메뉴 항목·순서·방향을 바꿀 수 있습니다. `template_id`와 변경 후의 전체 `bindings`, 유지할 제목·옵션을 함께 전달합니다. 부분 변경 입력이 아니므로 생략한 선택 옵션은 템플릿 기본값으로 돌아가며, 위치·크기는 생략 시 현재 경계를, 데이터 소스는 대상의 기존 소스를 유지합니다. 기존에 수동 지정한 스타일을 그대로 유지하는 용도에는 `component_update`를 사용합니다. `preview: true`로 검증한 뒤 대상만 한 번의 페이지 저장으로 반영합니다. 그룹 안의 차트는 `group_id`로 섹션 전체를 수정합니다. 저장된 원본 레시피·중첩 그룹·조건부 서식이나 외부 요소 참조가 있는 대상은 이 수정 경로에서 지원하지 않습니다. 그룹 요소 사이에 다른 요소가 끼어 있으면 겹침 순서가 달라지지 않도록 수정을 거부합니다.

`component_template_patch`는 같은 데이터 소스 안에서 측정항목만 부분 교체합니다. `component_id` 또는 평면 `group_id`와 `metrics:[{from:"매출",to:"주문"}]`를 지정합니다. 기존 개념 ID·제목·측정항목 라벨·기간·필터·정렬·스타일·위치·그룹 범위는 유지합니다. 같은 필드가 원값과 비중 열에 모두 쓰이면 함께 교체하되 비중 계산과 퍼센트 형식은 유지합니다. `aggregation`을 생략하면 호환되는 기존 집계를 유지하며, Auto 필드는 중복 집계를 제거합니다. Auto에서 일반 필드로 바꿀 때는 집계를 명시해야 합니다.

단위가 다르거나 기존 금액·퍼센트 표시 패턴을 새 지표에 그대로 쓸 수 있는지 불명확하면 `needs_input`과 확인 항목을 반환하고 저장하지 않습니다. `format:"source"`는 새 소스의 단위를 사용하고 원값 열의 명시 표시 패턴을 제거하며, `format:"preserve"`는 기존 형식을 유지하겠다는 선택입니다. 비중 열에는 이 초기화를 적용하지 않습니다. 제목과 라벨은 자동으로 새 지표 이름으로 바꾸지 않으므로 이름도 바꾸려면 `component_update`에서 명시합니다.

`preview:true`는 저장 없이 변경을 검사합니다. 실제 변경은 한 번의 페이지 저장이며, 잘못된 필드·모호한 이름·지원하지 않는 변환·변경 지표에 의존하는 조건이나 상수 기준값이 있으면 자동 적용하지 않습니다. 데이터 소스 교체·측정기준 변경·중첩 그룹·외부 시각화는 이 부분 수정 경로에 포함되지 않습니다. 값에 따라 의미가 달라지는 고정 축 범위 등 수동 스타일은 유지되므로 변경 후 표현도 확인해야 합니다.

`component_page_add`는 빈 페이지에 여러 공통 차트·요약 섹션을 자동 배치합니다. `items`에 `{key,template_id,bindings,data_source?,texts?,date_range?,common_options?,section_options?,span?,height?}`를 순서대로 전달합니다. `width`는 페이지 폭(생략 시 현재 폭), `columns`는 요청 열 수(1~4, 기본2), `gap`과 `padding`은 기본24px입니다. 차트의 최소 폭이 부족하면 열 수를 줄이고 순서대로 줄바꿈합니다. `span`은 차지할 열 수이며 일반 차트는 기본1, 요약 섹션은 기본 전체 열입니다. 요약 섹션은 배정된 폭에서 필요한 높이를 다시 계산합니다.

`sidebar:{width:240,title:"매출 리포트",navigation:{items:[{label:"요약",page:"요약"}]}}`로 왼쪽 메뉴를 함께 만들 수 있습니다. 메뉴 대상 페이지는 먼저 만들어야 하며 사이드바 영역은 차트와 분리합니다. 전체 요소를 저장 없이 검사한 뒤, 요소·그룹·최종 페이지 크기를 한 번에 저장합니다. `preview:true`는 배치와 크기만 반환합니다. 기존 요소·그룹 또는 보고서 공통 요소가 있으면 거부하므로 기존 페이지를 재배치하거나 덮어쓰는 도구는 아닙니다. 페이지 가장자리와 여백을 포함해 20,000px를 넘으면 다른 페이지로 나눠야 합니다.

개별 공통 차트도 `component_template_add`에서 위치를 생략하면 기존 요소를 피해서 배치하고, 필요한 페이지 크기를 차트와 함께 저장합니다. 명시한 위치는 그대로 사용하므로 의도적으로 지정한 겹침까지 자동으로 바꾸지는 않습니다. 섹션 추가·공통 컴포넌트 수정도 필요한 페이지 크기를 확보하며, 기존 보고서 전체의 크기는 바꾸지 않습니다. 이 기능은 생성·수정할 때의 배치이며 창 크기에 따른 실시간 반응형이나 이미 만든 사이드바의 자동 높이 동기화는 아닙니다.

공통 정의를 사용하는 V2 라이브러리도 같은 도구로 읽습니다. V2 레시피는 `definitions/`의 구조·동작·디자인을 조립한 뒤 기존 필드 바인딩 엔진에 전달합니다. 파일 참조 해시와 카탈로그·검증 기록의 최종 조립 해시가 맞아야 사용할 수 있습니다. 기존 V1 레시피도 계속 지원하며, 저장 형식을 바꾸는 것만으로 새 디자인이 검증 상태가 되지는 않습니다.

운영자가 `analysis-contracts.json`을 설치하면 `component_template_inspect`의 `analysis`에 원래 지표 계산 구조, 역할별 집계·날짜 묶음·비중 계산, 필터 조건과 입력 행 단위 확인 항목이 나옵니다. 원본 식별자와 원래 계산식은 공개하지 않습니다. 익명화된 계산 구조는 설명용이며 실행할 계산식이 아닙니다. 이 안내는 새 데이터에서 업무 의미가 같다는 보증이 아니므로 사용자가 요청한 지표 정의를 별도로 확인해야 합니다.

`component_template_plan`은 클라이언트가 해석한 분석 목적을 받아 연결된 소스의 필드와 집계를 검사합니다. 목적은 `trend`(시간 추이), `comparison`(분류 비교), `share`(비중), `kpi`, `detail`(상세표), `relationship`(관계), `overview`(요약 섹션), `cross_tab`(교차표)입니다. `template_id`를 생략하면 기본 구조를 추천하며 같은 목적의 대안도 알려줍니다. `bindings` 없이 호출하면 필요한 역할과 소스의 필드·자료형·가능한 집계를 확인할 수 있습니다.

일반 지표의 집계는 명시해야 합니다. 예를 들어 `{purpose:"trend", bindings:{date:"날짜", metric:{field:"매출", aggregation:"sum"}}}`처럼 전달하며, Auto 지표는 집계를 생략합니다. 동명 필드가 여러 개면 고유 ID를 선택해야 합니다. 소스가 여러 개면 `data_source`를 지정합니다. 비중 표를 선택하면 `percent_of_total:true`를 적용하며 명시적인 false는 거부합니다.

결과의 `status`는 `needs_input`(추가 선택 필요), `needs_preparation`(연결 또는 계산 필드 생성 필요), `invalid`(입력 수정 필요), `ready`(공개 도구 사전 검사 통과) 중 하나입니다. `ready`일 때만 `execution: {tool, arguments}`를 돌려주며, 클라이언트가 이 호출을 실행해야 저장됩니다. 계획 자체는 쓰기 비활성 상태에서도 사용할 수 있고 실제 요소나 스냅숏을 저장하지 않습니다. `target:{component_id}` 또는 `target:{group_id}`를 주면 전체 구성 수정 계획을 반환합니다. 계획을 만든 이후 보고서나 소스가 바뀌면 실행 시 다시 검증됩니다.

이 도구는 자연어 문장을 서버에서 해석하거나 업무 계산식을 추측하지 않습니다. 클라이언트가 사용자 의도·데이터 한 행의 의미·지표 정의를 확인하고 구조화한 입력을 전달합니다. 아직 연결되지 않은 BigQuery 데이터는 `connection`으로 지정하고, 필요한 계산식 한 개는 `calculated_field`로 지정할 수 있습니다. 계산식과 테이블 선택은 업무 정의를 확인한 클라이언트가 제공합니다.

새 소스는 `connection:{project_id,dataset_id,table_id,source_name?}` 또는 `{project_id,sql,source_name?}`로 지정합니다. 기존 `data_source`와 함께 사용할 수 없습니다. 선택한 테이블의 메타데이터 또는 읽기 전용 SQL의 문법·예상 읽기 크기만 확인합니다. SQL 매개변수는 이 계획 경로에서 지원하지 않습니다. 반환된 BigQuery 자료형을 Looker Studio의 확정 필드 ID·자료형으로 취급하지 않습니다.

계산 필드는 `calculated_field:{name,formula}`로 한 번에 하나씩 준비합니다. 예를 들어 `formula:"revenue - ad_cost"`를 확인한 뒤, `bindings.metric:{field:"광고비 차감 매출",aggregation:"sum"}`로 사용할 수 있습니다. 이미 집계한 `SUM(revenue)/SUM(orders)` 같은 수식은 실제 생성 후 Auto 여부를 읽고 집계 없이 연결합니다. 수식에 사용한 동명 필드는 고유 ID로 명확히 해야 합니다.

`needs_preparation`에는 `preparation` 한 단계와 `continuation`이 있습니다. 준비 호출이 성공한 뒤 continuation으로 다시 계획해야 합니다. 연결과 계산식이 함께 있으면 연결 → 실제 소스 조회 → 수식 검사·생성 → 실제 필드 조회 → 차트 검사 순서로 진행합니다. 계획 자체는 소스·필드·차트를 만들지 않으며, 미래의 임시 ID로 차트 실행 호출을 만들지 않습니다. 같은 이름의 기존 소스나 계산 필드가 있으면 새로 만들지 말고 기존 항목을 선택하도록 알립니다. 여러 계산식이 서로 의존하면 하나씩 생성한 뒤 다시 계획합니다.

자연어 요청을 처리하는 AI는 다음 순서로 기존 도구를 조합합니다. 서버 자체가 자연어 의도를 판단하거나 지표의 업무 의미를 추정하지는 않습니다.

1. 요청의 지표·기간·필터를 확인하고, 허용된 데이터의 스키마와 한 행의 의미를 조회합니다.
2. 분석 목적에 맞는 디자인을 검색·상세 조회합니다. 원래 지표를 다른 지표로 바꾸면 변경을 명시합니다.
3. 분석 계획에 측정기준, 측정항목, 계산식·집계, 단위, 기간과 필드 연결을 기록합니다. 불명확한 정의는 확인 후 진행합니다.
4. 필요한 계산 필드를 만들고 준비된 컴포넌트에 연결합니다.
5. 별도로 계산한 예상값을 `report_check`와 실제 `report_render`의 결과에 대조합니다. 정상 상태 응답만으로 계산이 맞다고 판단하지 않습니다.

## 사용 흐름

1. `connection_check`로 연결을 확인하고 `report_list`로 보고서를 고릅니다.
2. `page_list`, `datasource_list`와 `component_list`로 대상을 찾고, 수정할 요소는 `component_inspect`로 읽습니다. 대부분의 보고서 입력은 ID나 Looker Studio URL을 받습니다.
3. 쓰기를 켠 뒤 `chart_add`, `control_add`, `component_update` 등으로 편집합니다. 여러 작업은 `batch_apply`로 묶을 수 있습니다.
4. `report_check`로 데이터를 확인하고 `report_render`로 화면을 봅니다. PDF·PNG는 설정 폴더의 `renders/`에 저장됩니다. 수동 게시를 사용하면 서버 렌더는 게시된 버전을 보여줍니다. 현재 브라우저 화면은 `report_show`의 `screenshot: true`로 확인합니다.
5. 되돌릴 때는 `version_list`를 새로 읽고 `version_restore`에 목록의 위치나 이름을 지정합니다.

100% 누적 막대·영역 차트는 저장된 프리셋 이름과 실제 옵션이 달라도, 스펙 내보내기에서 실제 100% 모드를 반영합니다. 일반 누적으로 복원되어 비율의 의미가 바뀌는 것을 방지합니다. 전체 스타일 내보내기(`style: "all"`)는 자동 크기·범례·축 글꼴과 투명색도 보존합니다. 자동 설정을 지원하는 스타일 키에 `"Auto"`를 주면 명시값을 지우고 상속값을 사용합니다. 참조선의 `weight: "Auto"`도 같은 의미이며, 두께를 생략한 새 참조선의 기본값은 그대로입니다. 막대의 `Color by`, `Show data labels as`, `Bar color#2` 이후 색상 슬롯은 분류별 색과 퍼센트 라벨을 유지합니다.

비중 지표는 `metrics: [{field: "amount", aggregation: "sum", calculation: "percent_of_total", label: "비중"}]`처럼 지정합니다. 표시 이름만 바꾸면 계산은 달라지지 않습니다. `relative_to_base`와 `bypass_filters`는 계산 기준과 필터 적용 여부를 보존하는 선택 항목입니다. `date_range_dimension`으로 기간 필터에 쓸 날짜 필드를 명시할 수 있으며, `"None"`은 날짜 필드와 해당 요소의 기간 설정을 제거합니다.

새 BigQuery 소스는 커넥터의 기본 날짜 타입 지원을 켜고 반환된 날짜 메타데이터를 유지합니다. 기존 소스 새로고침과 보고서 복사 후 재연결은 기존 날짜 모드를 유지하며 자동 변환하지 않습니다. 주 단위로 묶은 축 라벨은 길어서 범주 한 칸에 들어가지 않으면 렌더러가 라벨을 모두 숨깁니다. 공통 복합 차트와 범주 선은 이 경우 라벨을 기울여 표시하며, 렌더러가 긴 라벨의 끝을 줄임표로 자를 수 있습니다.

차트별 날짜 단위와 숫자 표시 형식은 `field_formats`로 설정합니다. 예를 들어 `[{"field":"day","kind":"dimension","date_granularity":"Year Month","display_format":"y.MM"},{"field":"rate","kind":"metric","display_format":"0.00%"}]`는 월별 묶음과 비율 소수 둘째 자리를 유지합니다. 원본 소스의 자료형과 날짜 필터용 필드는 바꾸지 않습니다. `date_granularity: "Auto"`는 소스의 날짜 단위를 사용하고, `display_format: null`은 명시한 표시 형식을 제거합니다. 같은 필드가 여러 역할에 쓰이면 `kind`로 구분합니다.

표 스타일의 `"Column widths"`는 양수 배열(소수 픽셀 허용), 스코어카드의 `"Decimal precision"`은 0~20 정수, `"Comparison label"`은 비교 문구를 받습니다. `"Chart area width"`와 `"Chart area height"`는 차트 내부 영역 크기입니다. `reference_lines: []`는 모든 참조선을 지우며, 비어 있지 않은 배열은 기존 선에 추가합니다. 드롭다운·고정 목록 컨트롤의 `labels`는 필드별 표시 이름이고, `sorts`는 정렬 하나를 지정해 기존 정렬을 교체합니다(빈 배열은 정렬 제거). 목록 컨트롤에 정렬을 둘 이상 주면 저장 전에 거부합니다.

보고서를 옮기려면 `report_spec_export`를 사용합니다. `style`은 `none`, `main`, `all` 중 하나이며, `path`를 주면 JSON과 업로드 이미지 파일을 함께 저장합니다. `report_spec_apply`는 `spec` 객체 또는 `spec_path` 파일을 받습니다. 기존 보고서에 적용하면 빠진 항목을 더하며, 기존 항목의 설정은 유지합니다. 기존 테마를 바꾸려면 `apply_theme: true`가 필요합니다. 지원하지 않는 요소와 손실된 설정은 반환된 메모를 확인해야 합니다. 새로 연결하는 데이터 소스는 `field_overrides`로 원본 필드 이름·타입·집계 변경을 계산 필드와 차트 생성 전에 복원합니다. 기존 보고서에 이미 있는 소스에는 이를 자동 적용하지 않습니다.

스펙의 `calculated_fields`에는 `name`, `formula`, 선택적인 `data_source`, `type`, `aggregation`을 지정할 수 있습니다. 자료형과 기본 집계는 계산필드 생성 직후, 그 필드를 사용하는 다음 계산과 차트를 만들기 전에 복원합니다. 수식 자체가 집계하는 Auto 필드는 집계 옵션을 생략합니다.

`report_check`의 정상 판정은 데이터 요청·필드·빈 결과 검사입니다. 비중 계산의 의미나 원본 화면과의 일치를 보증하지 않습니다. 이식 후에는 내보내기 메모와 실제 값, `report_render` 결과를 함께 확인해야 합니다.

`batch_apply`와 명세 적용은 실행 전 검사를 하지만 전체 작업을 하나의 트랜잭션으로 묶지는 않습니다. 실행 중 실패하면 앞서 성공한 변경이 남으며, `continue_on_error`로 이후 작업의 계속 여부를 정합니다.

## 작업 기록과 복구 범위

페이지, 요소, 테마와 탐색 메뉴 등 보고서 문서를 편집하기 전에 이름 있는 버전을 저장합니다. 같은 서버에서 같은 보고서를 60초 안에 연속 편집하면 복구 지점을 공유할 수 있습니다. 버전 복원 직전에는 새 복구 지점을 만듭니다. 쓰기 호출의 성공·실패와 가능한 경우 버전·복구 지점은 설정 폴더의 `audit.ndjson`에 기록됩니다. 시험 실행도 기록됩니다.

`version_restore`는 보고서 버전을 복원합니다. 데이터 소스 자체의 필드·SQL·인증 변경, 재사용 소스 전환, BigQuery 뷰 생성·교체·삭제까지 되돌리는 기능은 아닙니다. 새 보고서 생성과 휴지통 이동도 이 편집 스냅숏의 대상이 아닙니다. 특히 재사용 소스 전환은 되돌릴 수 없고, 전환된 소스는 보고서를 삭제해도 남습니다.

## 지원 범위와 제한

- 데이터 소스 생성·재연결은 BigQuery 테이블·뷰·사용자 SQL, Google Sheets, GA4 속성을 지원합니다. PostgreSQL·MySQL·Google Ads 신규 연결은 지원하지 않습니다. BigQuery용 `data_control` 생성도 거부합니다.
- Google Sheets는 `connector: "google_sheets"`, `spreadsheet`(URL 또는 파일 ID), `worksheet`(탭 이름) 또는 `worksheet_id`(gid)를 받습니다. URL의 `#gid=0`도 사용할 수 있습니다. `range`는 선택한 탭 안의 A1 범위이며 `use_first_row_as_headers`와 `include_hidden_and_filtered_cells`의 기본값은 true입니다. Sheets 연결에는 BigQuery 청구 프로젝트나 ADC가 필요하지 않습니다.
- Sheets의 파일 접근권한과 Looker Studio 커넥터 인증은 로그인 계정에 있어야 합니다. 이 서버는 OAuth 승인 화면을 자동 수락하지 않습니다. 보고서 생성 전 탭·컬럼을 검사하며, 열 자료형은 Looker Studio의 추론 결과를 반환합니다. 필요하면 `field_update`로 수정합니다.
- GA4는 `connector: "ga4"`, `account_id`, `property_id`를 사용합니다. 두 ID는 숫자로 된 문자열이며 `G-` 측정 ID나 `UA-` 속성/보기 ID가 아닙니다. `view_id`, BigQuery·Sheets 옵션, SQL 매개변수를 섞으면 거부합니다. 로그인 계정의 속성 접근권한과 Analytics 커넥터 인증이 필요하며 승인 화면을 자동 수락하지 않습니다. BigQuery 청구 프로젝트·ADC는 사용하지 않습니다.
- GA4 연결은 기존 공통 소스 생성 절차를 사용하고 `datasource_list(fields:true)`로 실제 필드를 조회합니다. Auto 지표는 차트에서 aggregation을 생략해야 합니다. 속성별 사용자 정의 필드와 측정기준·지표의 호환성은 실제 소스에 따라 다르며 Data API 할당량이 적용됩니다. GA4 세그먼트·비교는 지원하지 않습니다. [Google의 연결·제한 사항](https://docs.cloud.google.com/data-studio/connect-to-google-analytics)
- `datasource_query`는 연결된 소스에서 측정기준·지표 값을 차트 저장 없이 읽습니다. 고정 `date_range`와 `date_range_dimension`을 지정하고, Auto가 아닌 지표는 집계를 명시합니다. 최대 500행의 첫 결과 묶음만 반환하며 `truncated`가 null이면 전체 여부를 알 수 없습니다. 페이지·보고서 필터와 화면에서 선택한 컨트롤 상태는 상속하지 않습니다. 행은 집계 결과이고 지표 조합에 따라 소스가 반환하는 분류 값도 달라질 수 있습니다. total_count는 해당 조회의 행 수이며 전체 분류 목록을 보장하지 않습니다. 샘플링·임계값·최신성도 보장하지 않습니다.
- GA4는 같은 커넥터의 복사 재연결·필드 새로고침·단순 속성 연결의 스펙 내보내기/재생성 경로를 지원합니다. 원본에 재현할 수 없는 세그먼트·알 수 없는 연결 옵션이 있으면 내보내기에서 사유를 표시하거나 복사 재연결을 거부합니다. 생성 링크에는 계정·속성 ID만 넣고 UA의 viewId는 넣지 않습니다. [공식 Linking API](https://developers.google.com/data-studio/integrate/linking-api)
- GA4 속성의 실제 연결·필드 조회·이벤트 및 지표 렌더를 검증했습니다. 속성별 수집 정의와 업무 지표의 정확성을 자동으로 보장하지는 않습니다. `component_template_plan.connection`은 계속 BigQuery 전용이며, GA4는 먼저 `report_create` 또는 `datasource_add`로 연결한 뒤 `data_source`로 선택해 차트를 계획합니다.
- 새 Sheets 연결에는 native 날짜 처리 모드를 저장합니다. 기존 legacy/Text 소스의 자동 변환을 뜻하지 않습니다. 열·숨김·필터 또는 값 변경 후 오래된 합계나 구성 오류가 보이면 `report_render`에 `refresh_data:true`를 지정하거나 먼저 `report_data_refresh`를 호출합니다. 이 동작은 Looker Studio 편집기의 데이터 새로고침과 같은 타임스탬프 갱신이며, 두 합성 보고서에서 오래된 값·오류가 최신 합계로 바뀌는 것을 확인했습니다. `datasource_refresh`의 열 구조 갱신과는 별도입니다.
- `refresh_data`의 기본값은 false입니다. true에는 쓰기 허용이 필요하고 dry-run이면 새로고침과 렌더를 모두 건너뜁니다. 호출은 한 번만 하며 서비스의 새로고침 제한·데이터 소스 반영 지연을 우회하지 않습니다. 차트 설정·공유·게시 상태를 바꾸지 않으며 항상 즉시 최신값을 보장하는 기능은 아닙니다.
- 사본의 데이터 소스를 재연결할 때는 같은 커넥터끼리만 지원합니다. BigQuery와 Sheets 사이에서 바꾸려면 새 보고서에 컴포넌트를 추가하면서 새 필드를 연결해야 합니다. 생성 링크는 탭 이름 대신 gid가 필요합니다. Sheets의 저장된 헤더·숨김 옵션이 불명확하거나 서로 다른 숨김/필터 옵션을 공개 입력으로 표현할 수 없으면 스펙 내보내기에서 해당 소스를 제외하고 이유를 표시합니다.
- 조회 SQL은 단일 SELECT 또는 WITH 문이어야 합니다. 뷰 저장·삭제는 전용 쓰기 도구를 사용합니다.
- 이메일 매개변수 `@DS_USER_EMAIL`의 사용자 동의와 생성 링크의 Google 데이터 확인창은 완전한 동작 검증이 끝나지 않았습니다. `report_link_build`는 URL만 반환하며 사용자가 직접 열고 저장해야 합니다. 동의가 필요한 보고서는 사용자가 확인해야 합니다.
- 공유·초대 실행과 임베드 코드 발급 도구는 제공하지 않습니다. Invite people 버튼의 설정 저장과 복사는 지원하지만 실제 공유를 실행하지는 않습니다.
- 이미지의 `Border radius` 설정은 저장되지만, 이미지 자체의 모서리를 둥글게 잘라내는 동작은 확인되지 않았습니다. 차원 선택기는 처음에 선택되지 않은 상태로 표시되며, 목록에서 차원을 고르면 제목에 그 이름이 나타납니다.
- 커뮤니티 Gauge는 필터나 기간으로 결과가 `null`이 되면 `Invalid Metric Value`를 표시할 수 있습니다. `report_check`와 `report_render`는 확인 가능한 단일 집계행의 모든 지표가 NULL이면 데이터 없음 안내를 반환합니다. 실제 값 0과 NULL은 구분하며, 외부 시각화의 표시나 데이터를 바꾸지는 않습니다.
- 참조선은 상수 값과 지표 계산을 지원합니다. 지표는 `metric`, 계산은 `calculation`, 두께는 `weight`로 지정하며 백분위 계산에는 `percentile`이 필요합니다. 매개변수 참조선은 연결 정보를 보존할 수 없어 거부합니다. 지원하지 않는 계산·참조선 설정은 내보내기 메모를 확인해야 합니다.
- Looker Studio의 내부 API를 사용하므로 서비스 변경에 따라 조정이 필요할 수 있습니다.



```sh
npm test
npm run typecheck
npm run build
```

단위 검사는 가짜 브라우저를 사용하며 실제 브라우저가 필요하지 않습니다. `npm run gen`은 19개 기능 폴더의 도구와 확장을 모아 등록 파일을 만듭니다. 빌드, 타입 검사와 단위 검사에서도 자동 실행됩니다.

연결별 설정·인증·컬럼 조회는 `src/connectors/`의 어댑터가 맡고, 데이터 소스 저장·게시·보고서 연결은 `src/core/datasource.ts`가 공통으로 처리합니다. `connector_list`는 등록된 구현에서 지원 정보를 가져옵니다. SQL 변경과 생성 링크는 선택적인 기능이므로 새 커넥터가 반드시 구현할 필요는 없습니다. 현재 BigQuery·Google Sheets·GA4가 등록되어 있으며, 다른 커넥터를 추가할 때도 입력 검증과 인증 흐름을 구현하고 실제 보고서까지 검증해야 합니다.

실계정 검사는 `LOOKER_STUDIO_MCP_LAB_TABLE=project.dataset.table npm run test:live`로 실행합니다. 등록 파일을 먼저 생성한 뒤, 도구 통합 계약 검사와 실험 세션 검사를 순서대로 실행합니다. 통합 검사는 PNG 변환기와 PDF 텍스트 대조용 `pdftotext`(Poppler)가 필요하며, 생성·수정·복원·삭제와 MCP 호출을 확인합니다. 실제 BigQuery 쿼리 비용이 생길 수 있습니다. 검사마다 별도 세션을 쓰며, 직접 만든 실험용 보고서에만 쓰고 끝나면 정리합니다. `LANES=1`이면 한 세션만 사용합니다.

### 커넥터별 MCP 반복 검증

`test:connector-e2e`는 새 제품 MCP에 stdio로 연결해 생성 → 필드 설정 → 준비된 컴포넌트 추가 → 데이터 검사·렌더 → 스펙 왕복 → 휴지통 정리를 실행합니다. 먼저 빌드하고, 시나리오와 결과는 저장소 밖에 둡니다.

```sh
npm run build
LOOKER_STUDIO_MCP_COMPONENT_LIBRARY=/path/to/private/library \
  npm run test:connector-e2e -- \
  --scenario /path/to/scenario.json --output /path/to/new-results --lane 1
```

레인은 1~3이며 같은 레인을 동시에 실행하지 않습니다. 출력 폴더에 이전 실행 기록이 있으면 덮어쓰지 않습니다. BigQuery는 청구 프로젝트를 명시한 합성 SELECT만, Sheets는 시나리오의 `allowed_spreadsheets`에 지정한 파일만 연결합니다. 비밀값은 시나리오에 넣지 않습니다. `{"$env":"E2E_PROJECT"}`처럼 환경 변수로 실험 식별자를 전달할 수 있습니다.

시나리오에는 `name`, `source`, `templates`, `expect.normal`, `expect.total`이 필요합니다. 선택적인 `setup`은 `{tool,args,expect_error?,expect_text?}` 배열로 필드 자료형·집계·계산필드를 준비합니다. 숫자 계산필드의 기본 집계가 `none`이면 목적에 맞게 SUM·AVG를 명시하고, Auto 계산필드에는 집계를 덧붙이지 않습니다. 템플릿의 역할은 `component_template_inspect`로 먼저 확인합니다. 예를 들어 분류·KRW 금액 역할을 받는 표는 다음처럼 검사할 수 있습니다.

```json
{
  "name": "amount-table",
  "billing_project": {"$env": "E2E_PROJECT"},
  "source": {"sql": "SELECT 'Alpha' AS category, 10 AS amount", "source_name": "Test data"},
  "setup": [{"tool": "field_update", "args": {"field": "amount", "type": "Currency > KRW"}}],
  "templates": [{"template_id": {"$env": "E2E_TEMPLATE_ID"}, "bindings": {"dimension_1": "category", "metric_1": "amount"}}],
  "expect": {"normal": 1, "total": 1, "render_text_includes": ["Alpha", "10", "100%"]},
  "roundtrip": true
}
```

`roundtrip` 기본값은 true입니다. 원본·사본의 필드 정보, PNG 바이트와 스펙을 비교합니다. `expect.render_text_includes`는 MCP가 반환한 해당 실행의 PDF를 `pdftotext`로 읽어 지정한 문구가 있는지 검사하며, 도구가 없거나 문구가 빠지면 실패합니다. 이 옵션이 없으면 표시값은 수동 검토 대상으로 기록합니다. 문구 검사와 이미지 일치만으로 모든 계산 의미·배치를 보증하지는 않습니다.

종료 코드는 0=설정된 자동 검사 통과, 1=실패, 2=테마 표현 차이 검토 필요입니다. `result.json`, `calls.ndjson`, 원본 이미지·해시·스펙과 `created.json`을 남기며, `render_text_includes`가 있으면 PDF 텍스트도 저장합니다. 실패해도 확인된 생성 보고서만 휴지통으로 이동합니다. 영구 삭제는 `created.json`의 실험 ID를 확인한 뒤 별도 감독 단계에서 수행합니다. 고객 시트의 셀이나 공유·인증 설정을 변경하지 않습니다.

### 공통 디자인의 밀도와 배치

분석할 항목과 정의를 먼저 정한 뒤 배치를 선택합니다. 페이지 생성은 전달한 항목 수를 유지하며, 공간을 채우려고 지표를 추가하지 않습니다. `appearance` 적용은 스타일 쓰기 전후에 차트 구성과 분석 설정을 비교하고, 허용한 표현 외의 변경이 있으면 저장 전에 거부합니다. 이 검사는 입력한 분석 명세 자체가 사용자의 의도에 맞는지 판단하지는 않습니다.

공통 구조의 목록·상세 조회에는 `option_effects`가 함께 나옵니다. 비교·평균·비중·정렬·누적은 분석 선택, 방향·원형/도넛·피벗 종류·보조축은 구조 선택, 색·표면·라벨은 표현 선택으로 구분합니다. 구조가 같다는 사실이 다른 소스의 업무 정의나 집계까지 같다는 뜻은 아닙니다.

공통 차트의 최상위 `sort_by`, `sort_ascending`, `field_formats`는 분석 명세에 따라 명시합니다. 이 값들은 생성·계획·재구성·페이지 조립에 전달되어 별도 저장 없이 적용됩니다. 예를 들어 `field_formats:[{field:"day",kind:"dimension",date_granularity:"Year Month"}]`는 날짜 표시를 월 단위로 묶되 날짜 필터의 원래 정밀도를 유지합니다. `sort_ascending`은 sort_by와 함께 사용하고, 범주 선의 dimension_order와 동시에 정렬을 지정하면 거부합니다. 같은 소스 필드를 합계·평균 등으로 여러 번 사용하는 경우 sort_by에는 고유한 차트 표시 이름을 지정해야 합니다. 모호한 소스 ID는 저장 전에 거부합니다. field_formats의 날짜 변환과 숫자 표시 형식은 기존 공개 유효성 검사를 따릅니다. 저장 레시피와 overview/navbar 구성에는 이 공통 차트 전용 입력을 전달할 수 없습니다.

상세 표는 `common_options.presentation`으로 머리글과 기존 비중 열의 표현을 독립적으로 고릅니다. `table_header:"surface"`는 목적 테마의 표면색/본문색, `"inverse"`는 그 반대 역할을 사용합니다. `share_display:"number"|"heatmap"`은 이미 분석 옵션 `percent_of_total:true`로 선택한 비중 열만 바꾸며, 계산이나 열을 자동 추가하지 않습니다. 비중 열 없이 share_display를 지정하거나 다른 공통 구조에 presentation을 주면 저장 전에 거부합니다.

```json
{
  "common_options": {
    "percent_of_total": true,
    "data_bars": true,
    "presentation": { "table_header": "inverse", "share_display": "heatmap" }
  }
}
```

이 예시는 비중 분석을 선택한 표의 표현입니다. 비중이 필요하지 않은 경우에는 해당 분석 옵션과 share_display를 모두 생략합니다. presentation을 생략하면 기존 동작을 유지하며, 항목에 명시한 표현은 페이지의 outlined-report 기본 표현보다 우선합니다. 표면 머리글은 테마 역할을 사용하는 제품 선택지이며 특정 원본 디자인의 복제를 보증하지 않습니다.

`common-overview-section`은 평균선과 비중표를 포함하는 분석 구성입니다. 단순히 디자인을 입히기 위해 선택하는 옵션이 아니며, 그 분석이 필요할 때 사용합니다. 디자인 변경을 위해 연속 시간축을 날짜 범주축으로 바꾸면 분석 의미가 달라지므로 동일한 작업으로 취급하지 않습니다.

`component_page_add`의 `density: "compact"`는 작은 헤더·간격·차트 높이로 새 페이지를 구성합니다. `header: {title, description?}`로 제목 영역을 한 번만 만들고, `fit_height:true`로 빈 페이지의 높이를 내용에 맞출 수 있습니다. compact에서는 fit_height가 기본 true이며, 기존 comfortable 모드는 이전 크기 정책을 유지합니다. 명시한 항목 높이·간격과 항목별 옵션은 자동 기본값보다 우선합니다.

같은 도구의 `regions`는 차트 좌표 대신 분석 영역의 관계를 받습니다. 기존 `items`와 둘 중 하나만 지정하며, 영역마다 `{key, kind, title, items}`를 넣습니다. 각 하위 항목은 기존 공통 차트의 `template_id`, `bindings`, `data_source`, `common_options` 등을 그대로 사용합니다.

| 영역 kind | 하위 항목 순서 | 배치 |
|---|---|---|
| `kpi-group` | KPI 2~6개 | 한 제목 아래 가로 배열, 부족하면 다음 행 |
| `kpi-trend` | KPI 1~4개 다음 시간 추이 1개 | 왼쪽 KPI 묶음, 오른쪽 추이 |
| `table-trend` | 상세 표 다음 시간 추이 | 표와 추이를 나란히 |
| `table-share` | 상세 표 다음 원형 비중 차트 | 표와 비중 차트를 나란히 |

`kpi-trend`와 `table-trend`의 추이 자리에는 `common-category-line`을 명시적으로 선택할 수도 있습니다. `show_values:true`로 점·값 라벨을 표시하고 `dimension_order:"ascending"`으로 날짜 범주 순서를 지정할 수 있습니다. 이 방식은 날짜를 같은 간격의 범주로 놓으므로 누락된 날짜 사이의 실제 시간 간격을 보존하지 않습니다. 연속 시간 추이를 자동으로 바꾸지 않으며, 같은 데이터라도 네이티브 자동 축과 배치가 달라질 수 있습니다.

`kpi-trend` 영역에 `kpi_columns:2`를 지정하면 KPI 2~4개를 왼쪽 두 열에 놓습니다. 지정하지 않으면 기존 한 열 배치를 유지합니다. 좌우 배치 폭이 부족하면 추이를 아래로 보내고, KPI 두 열의 최소 폭도 부족하면 한 열로 바꿉니다. 다른 영역에서는 이 옵션을 받지 않습니다.

페이지의 `appearance:"outlined-report"`는 공통 10종의 글자 역할을 맞춥니다. KPI·시간 추이·범주 선·상세 표는 색과 정렬도 적용하고, 다른 구조는 지원되는 제목·범례·축 글꼴을 적용합니다. 피벗은 제목·본문·머리글 크기와 목적 테마의 반전 머리글 색을 적용합니다. 축이 있는 차트는 범례를 위쪽 시작점에 맞추되 범례 표시 여부는 유지합니다. 원형 차트의 범례 배치는 유지합니다. 여러 계열의 팔레트, 축 역할, 누적 방식, 원형/도넛·산점/버블 종류는 유지합니다. 생성 시 대상 테마의 본문색을 기본 선과 상세 표 머리글에, 강조색을 표의 데이터 표현에, 배경색을 머리글 글씨에 사용합니다. KPI 이름·값·비교는 가운데 정렬하며 명시한 emphasis는 유지합니다. 필드·집계·정렬·기간·계산은 바꾸지 않고, 막대·비중·값 라벨의 사용 여부는 기존 common_options로 정합니다. 요약 섹션 등 공통 차트 외 구성은 저장 전에 거부합니다.

이 표현의 표는 행 높이 32px, 기본 표시 5행을 사용합니다. 필요한 최소 높이는 `96 + 표시 행 수 × 32`이며 명시한 높이가 부족하면 저장하지 않습니다. 옵션을 생략한 페이지는 기존 동작을 유지합니다. 색과 글꼴은 생성 시 해석하므로 나중에 보고서 테마를 바꿔도 명시된 차트 스타일이 자동으로 다시 연결되지는 않습니다. 테두리와 영역 제목 표현은 기존 design 옵션으로 정합니다.

`outlined-report`에서 `show_values:true`인 시간 추이·범주 선에는 최소 720px의 차트 폭을 확보합니다. 나란히 들어가지 않으면 아래로 배치하고, 전체 가용 폭도 부족하면 저장 전에 거부합니다. 날짜나 값 라벨을 몰래 숨기지 않습니다. 이 최소 폭이 모든 관측점 수와 긴 숫자의 가독성을 보장하지는 않으므로 실제 기간·필터 상태에서도 확인해야 합니다.

이 표현의 선은 그라데이션 채움을 사용하지 않습니다. 시간 추이의 값 라벨은 테마 표면색 배경을 사용해 뒤쪽 선과 글자를 구분합니다. 개별 차트의 공개 스타일 `Data label background color`, `Data label background opacity`로 색과 불투명도를 지정할 수 있으며, `#2` 등의 접미사로 다른 계열을 지정합니다. 축 범위·눈금·날짜 간격·계산을 바꾸는 옵션은 아닙니다. 다른 데이터의 긴 라벨과 축 눈금이 함께 읽히는지는 실제 화면에서 확인해야 합니다.

영역은 위에서 아래로 쌓고, 제목·안쪽 여백·하위 차트의 최소 크기를 포함해 캔버스 높이를 계산합니다. 기본 폭은 1500px이며 명시한 width가 우선합니다. 좌우 배치가 불가능하면 세로로 전환합니다. 영역 내부 span은 받지 않고 height는 명시할 수 있습니다. 같은 페이지 전체에서 하위 key가 고유해야 합니다. 이는 생성 시 배치이며 브라우저 크기 변경에 따른 자동 재배치는 아닙니다.

`kind:"block"`은 공통 차트 10종 중 1~8개를 한 제목 아래 자유롭게 묶습니다. KPI는 왼쪽에 좁게 모으고(3개 이상이면 두 열) 첫 차트 행을 옆에 둡니다. 나머지 차트는 입력 순서대로 한 행에 최대 3개씩 놓으며 원형은 좁게, 교차표는 넓게 잡습니다. 영역에 `share`(2~10)를 주면 페이지 폭을 12등분한 칸 수만큼 차지하고, share가 있는 연속된 영역은 합이 12를 넘기 전까지 좌우로 나란히 같은 높이로 놓입니다.

`header`에는 `band_color`(#RRGGBB)와 `logo: {image, width?, height?, alt_text?}`를 줄 수 있습니다. band_color는 머리 영역을 그 색으로 채우고 글자는 흰색과 테마 글자색 중 더 잘 읽히는 쪽을 씁니다. 로고는 제목 앞에 놓이며 페이지 저장 뒤 별도 단계로 올립니다. 올리지 못해도 페이지는 유지되고 결과의 `logo.added`가 false로 표시됩니다.

`tabs: {items: [{label, page}]}`는 머리 영역 아래에 페이지 탭을 한 줄로 놓습니다. 같은 보고서의 기존 페이지로 이동하며 현재 페이지를 테마 강조색(`theme_update`의 `Accent background color`)으로 표시합니다. 탭으로 묶을 페이지를 먼저 만든 뒤 각 페이지에 같은 `tabs`를 지정합니다. `common-navbar`의 상단 메뉴는 `navigation.align: "start"`로 버튼을 왼쪽부터 놓을 수 있습니다.

차트 계열 색은 `theme_update`의 `settings: {"Series colors": ["#1F5FD1", "#F28C28"]}`로 정합니다. `settings: {"Brand color": "#7A1F3D"}`처럼 브랜드 색 하나만 주면 강조색, 읽기 쉬운 강조 글자색, 같은 계열의 차트 색(브랜드 색, 옅은 색조, 중립 회색)을 함께 정하며, 따로 지정한 항목이 우선합니다. 상세 표의 막대와 비중 열지도는 첫 계열 색을 따릅니다. 테마의 구성요소 배경이 투명이면 밝은 캔버스에서는 영역 표면을 흰색으로 둡니다.

`component_page_outline`은 사용자가 고른 `metrics`와 `dimensions`를 받아 이 구성을 제안합니다. 지정한 고정 기간에 각 분류의 값이 몇 개인지 읽고, 6개 이하면 도넛과 표(14일 이하면 날짜별 100% 누적 막대 포함), 7~12개면 가로 순위 막대와 표, 그보다 많으면 페이지를 넘기는 표를 고릅니다. `cross`의 분류 쌍은 행 수에 맞춘 높이의 열지도 교차표가 됩니다. 지표·분류·비교·평균선을 스스로 더하지 않으며, 쓰지 않은 분류는 목록으로만 알려줍니다. `page`, `header`, `tabs`, `design`을 이 도구에 함께 주면 결과의 `page_add`를 그대로 `component_page_add`에 넘길 수 있습니다. 비교를 지정하면 KPI의 증감률에만 넣습니다. 추이의 비교 기간 선은 `include.trend_comparison: true`, 분류별 표의 증감 열은 `include.table_comparison: true`로 따로 켜며, 증감 열이 있는 표에는 비중 열을 넣지 않습니다. `include`의 `overview`, `share_column`, `daily_share`, `filters`를 false로 주면 해당 부분을 뺍니다. `trend: {by: "week"|"month"}`는 추이를 주별·월별로 묶고, `trend.with_second_metric: true`는 첫 지표를 막대, 둘째 지표를 오른쪽 축의 선으로 함께 그립니다.

`component_report_add`는 여러 페이지를 한 번에 만듭니다. `pages`에 페이지마다 `name`과 `metrics`, `dimensions`, `cross`, `trend`, `include`를 주고, 기간·비교·머리 영역(`header.band_color`, `header.logo`, `header.description`)·`design`은 공통으로 줍니다. 새 보고서의 빈 첫 페이지를 첫 번째 페이지로 쓰고 나머지를 추가한 뒤, 페이지마다 `component_page_outline`과 같은 규칙으로 구성합니다. 페이지 이동은 보고서의 기본 페이지 메뉴(왼쪽)로 하며, 페이지에 `section`을 주면 같은 이름의 연속된 페이지를 그 메뉴의 한 구역으로 묶습니다. `tabs: true`는 같은 구역의 페이지끼리(구역이 없으면 모든 페이지를) 페이지 안 탭으로도 연결합니다. 메뉴 구역에는 아이콘이 붙습니다. `section_icon`에 Material 아이콘 이름을 주거나, 생략하면 구역 이름에 맞춰 고릅니다(개요 dashboard, 사용자 face, 획득 groups, 행동 explore, 상품 shopping_cart, 주문·매출 storefront, 재사용 trending_up, 광고 campaign, 그 외 article). 페이지 아이콘은 `icon`으로 주며, 구역 없는 첫 페이지는 기본이 home입니다. 쓰기 전에 모든 페이지의 필드와 값 개수를 검사합니다. 페이지는 각각 저장되므로 뒤 페이지가 실패하면 앞 페이지는 남고 결과에 실패한 페이지를 알려줍니다. `preview: true`는 구성안만 반환합니다. `brand_color`를 주면 테마의 강조색·차트 색 계열과 모든 페이지의 머리 영역 배경을 함께 맞춥니다. 필드 이름 변경은 먼저 적용합니다.

`design: {surface:"outlined"|"plain", heading:"plain"|"band"}`로 테두리와 머리글 표현을 정합니다. 기본은 outlined/plain이며 `regions[].design`의 명시 값이 페이지 기본값보다 우선합니다. 색과 글꼴은 대상 보고서의 테마에서 가져옵니다. band는 테마의 본문색·표면색을 반전해 머리글을 구분합니다. 페이지 `design`의 `table_header:"accent"`는 상세 표와 교차표의 머리글을 테마 강조색으로 채웁니다(기본 `text`는 테마 글자색). `component_page_outline`이 만드는 교차표는 행을 첫 지표가 큰 순서로 놓습니다. 하위 차트는 기본 plain 표면이고 명시한 surface는 유지합니다. 영역과 `content_frame`은 함께 사용하지 않습니다.

`component_template_list`에 `query:"region-", verified_only:false`를 주거나 `component_template_inspect`에서 `region-kpi-group` 등을 조회하면 영역 명세와 하위 제약을 볼 수 있습니다. 이 항목의 addable:false는 개별 template_add 대상이 아니라는 뜻이며 실제 조립은 component_page_add로 합니다. 별도 도구나 고객 원본 카탈로그는 추가하지 않습니다.

이미 만든 페이지의 구성을 바꿀 때는 `replace: {confirm_page_name: "<현재 페이지 이름>"}`을 줍니다. 그 페이지의 기존 내용을 모두 지우고 새 구성을 한 번의 저장으로 넣으며, 이름이 정확히 맞지 않으면 아무것도 바꾸지 않습니다. 다른 페이지는 그대로이고 저장 전 스냅숏으로 되돌릴 수 있습니다. `component_page_outline`에 새 지표·분류와 함께 `page`, `replace`를 주면 결과를 그대로 넘겨 수정할 수 있습니다.

`preview:true`는 실제 하위 차트 검증까지 수행하고 저장하지 않습니다. 결과의 regions에는 각 영역의 위치·크기·디자인과 하위 차트 ID·규칙이 포함됩니다. 모든 영역이 준비된 뒤 페이지를 한 번 저장하며, 앞 영역이 성공했어도 뒤 항목이 실패하면 페이지를 쓰지 않습니다. 영역은 새로운 네이티브 그룹을 만들지 않아 페이지 controls의 적용 범위를 유지합니다. `controls`를 지정하면 모든 하위 차트에 같은 소스와 date 역할이 필요합니다. 기존 콘텐츠가 있는 페이지에는 추가하지 않습니다.

`content_frame: {title}`은 본문 차트를 제목과 하나의 테마 배경 안에 배치합니다. 안쪽 여백을 제외한 폭으로 열 수를 계산하고, 개별 차트는 기본적으로 `surface:"plain"`을 사용합니다. 명시한 surface는 유지합니다. 시각적인 묶음이며 기간·필터 적용 범위를 바꾸는 그룹은 만들지 않습니다. 관련 추이·표는 items의 span으로 나란히 배치할 수 있습니다.

공통 KPI의 `emphasis:"primary"|"secondary"`로 주 지표와 보조 지표의 숫자 크기를 구분합니다. compact 상세 표의 비중 열은 금액 열보다 좁게 배치하며 계산과 필터는 유지합니다. 페이지 필터는 날짜 280px·분류 220px를 기준으로 배치하고, 폭이 부족하면 다음 줄로 이동합니다.

`fit_height`는 생성할 캔버스의 높이를 정하며 브라우저 확대율을 바꾸지 않습니다. `theme_update`의 `layout: {"Display mode":"Actual size"}`는 과도한 확대를 막을 때 사용합니다. 이 설정은 보고서 전체에 적용되며 화면 높이에 맞춰 자동 축소하는 기능은 아닙니다.

개별 공통 차트의 `common_options`에도 density를 지정할 수 있습니다. `surface:"plain"`은 그룹 안에서 중복된 카드 배경·테두리·그림자를 제거합니다. 공통 상세 표의 `visible_rows`는 페이지당 표시 행 수와 기본 높이를 함께 정하며, 데이터 조회·집계·필터를 변경하지 않습니다. 명시 높이가 필요한 행 수보다 작으면 저장 전에 거부합니다. 단일 계열의 범례·점은 compact에서 줄이지만 여러 계열의 구분은 유지합니다.

공통 추이 차트의 `show_values:true`는 데이터 라벨과 점을 표시합니다. 날짜 수가 적어 개별 값을 읽어야 할 때 선택합니다. 범주 막대에서는 값 라벨을 표시하고, 100% 누적 막대에서는 조각 비중으로 표시합니다. 막대 한 칸이 약 40px보다 좁거나 아주 작은 조각이 있으면 라벨이 겹치므로 켜지 않습니다. 가로 막대는 긴 분류 이름이 잘리지 않도록 이름 축을 넓게 잡습니다. KPI의 `comparison_label`은 비교 값 옆 문구를 정합니다. KPI의 `progress:true`는 비교 기간 값 대비 현재 값을 KPI 아래 막대로 표시하며 `comparison`이 필요합니다. 이때 비교 값은 증감률 대신 비교 기간 대비 비율로 표시됩니다. `component_page_outline`에서는 `include.kpi_progress:true`로 켭니다. `comparison`은 KPI 외에 시간 추이와 상세 표에도 지정할 수 있습니다. 추이는 비교 기간을 두 번째 선으로 그리고 범례를 표시하며, 표는 지표마다 증감 열을 더합니다. `component_page_outline`은 비교를 KPI에만 넣으며, `include.trend_comparison`으로 추이에도 넣으면 두 선의 값 라벨이 겹치지 않도록 추이의 값 라벨을 끕니다. 주 단위(`Year Week`)로 묶은 복합 차트와 범주 선은 긴 주간 라벨이 숨겨지지 않도록 30도 기울여 표시하며, 축별 `Axis label rotation`(0~90) 스타일로 직접 지정할 수도 있습니다. 공통 상세 표의 `data_bars:true`는 측정항목을 숫자가 함께 표시되는 막대로 보여주며 집계 값을 바꾸지 않습니다.


KPI·시간 추이·상세 표는 `common_options.design_rules:"team-v1"`으로 표현 관계 규칙을 적용할 수 있습니다. 추이는 점과 값 라벨, 표는 숫자가 함께 보이는 막대를 기본 표시하며 KPI는 이름·값·비교의 정렬을 맞춥니다. 명시한 `show_values:false` 또는 `data_bars:false`가 우선합니다. 테마와 기존 글자 크기는 유지하고, 평균선·비중·합계·조건부 서식을 자동 추가하지 않습니다. 관측점 수와 라벨 길이를 자동으로 검사하지 않으므로 렌더에서 겹침을 확인해야 합니다. preview와 생성 결과의 `design_rules`에 적용·명시 변경·주의 항목을 반환하고 페이지 생성에서도 항목별로 전달합니다. 다른 차트 종류와 요약 섹션에는 이 규칙을 아직 적용하지 않습니다. 이 옵션은 전체 프로젝트 디자인을 자동 재현하는 기능이 아닙니다.

`component_page_add.controls`에 `{data_source, date_range, date_range_dimension, dimensions:[{field,label?}]}`를 주면 페이지 상단에 기간 선택기와 최대 두 분류 필터를 만듭니다. 모든 항목은 일반 공통 차트여야 하며 같은 소스와 명시적인 `bindings.date`를 사용해야 합니다. 항목의 소스를 생략하면 컨트롤 소스를 사용합니다. 다른 고정 기간이나 독립 그룹 섹션은 저장 전에 거부합니다. 차트는 선택기의 기간을 상속하며 이전 기간 비교 설정은 유지합니다.

분류 항목에 `display:"list", visible_rows:3`을 지정하면 팝업 대신 고정 체크 목록을 배치합니다. display 기본값은 dropdown이며 visible_rows는 list에서만 3~10을 받습니다. visible_rows는 표시 높이의 힌트로서 조회 행 수나 선택 가능한 값을 제한하지 않습니다. 항목이 많으면 스크롤하며, 검색·전체 선택·복수 선택은 그대로 사용할 수 있습니다. 헤더는 목록 높이만큼 커지므로 소수 항목을 항상 보일 필요가 있을 때 선택합니다.

제목과 필터를 같은 테마 패널에 배치합니다. 공간이 충분하면 제목은 왼쪽, 분류·기간은 오른쪽에 놓고 좁으면 아래로 이동합니다. 내부 필드명과 선택 상태를 사용해 이름을 중복 표시하지 않으며, 분류 목록의 불필요한 측정값 열은 숨깁니다. 필터 높이는 44px이고 검색·전체 선택·복수 선택은 유지합니다. 적용 범위 안내를 포함하며, 결과의 `header_layout`은 inline 또는 stacked입니다. 펼친 목록의 크기와 위치는 Looker의 기본 동작을 따릅니다.

컨트롤의 `Border opacity`는 테두리의 불투명도를 지정합니다(`1` 또는 `"100%"`는 불투명, `0`은 투명). 페이지 필터는 테두리 색·두께와 함께 불투명도를 명시합니다. 기존 컨트롤의 투명도를 임의로 바꾸지는 않습니다.

공통 요약 섹션은 `section_options: {density:"compact", table_rows:5}`로 관계있는 KPI·추이·표를 하나의 배경에 배치하고 반복 제목을 줄입니다. 기간·분류 컨트롤의 그룹 범위는 유지합니다. 생성 시 배치이며 브라우저 폭에 따른 자동 재배치는 아닙니다.

이 규칙은 직접 작성한 범용 코드이며 고객사 원본 보고서·추출 카탈로그·고객명·실제 데이터·원본별 좌표나 팔레트를 제품에 포함하지 않습니다. 외부 `component_library`를 운영할 때도 고객 원본 분석 폴더를 연결해서는 안 되며, 별도로 검수한 범용 정의만 제공해야 합니다. 외부 문구를 자동 익명화하는 기능은 아닙니다.
