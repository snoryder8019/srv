/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
var __webpack_exports__ = {};

;// CONCATENATED MODULE: ../mods/markers/mapComponent.js
/* eslint-disable react/prop-types */

function MarkersComponent({
  map,
  React,
  HTTP,
  checkPermission,
  useQuery,
  LayerGroup,
  LayersControl,
  Marker,
  Tooltip,
  HideBasedOnAuth,
  L
}) {
  const [markers, setMarkers] = React.useState([]);
  const {
    data
  } = useQuery('markers', async () => HTTP.get('/api/markers'));
  React.useEffect(() => {
    async function getMarkers() {
      if (checkPermission({
        module: 'webapi.Markers',
        method: 'GET'
      })) {
        const markerComponents = data.map(marker => {
          const {
            x,
            y,
            icon = 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/Blue_question_mark_icon.svg/1200px-Blue_question_mark_icon.svg.png'
          } = marker;
          const iconComponent = L.icon({
            iconSize: [25, 25],
            iconUrl: icon
          });
          return /*#__PURE__*/React.createElement(Marker, {
            key: marker.id,
            icon: iconComponent,
            position: {
              lat: x,
              lng: y
            }
          }, /*#__PURE__*/React.createElement(Tooltip, null, marker.name));
        });
        setMarkers(markerComponents);
      }
    }
    getMarkers();
  }, [data]);
  return /*#__PURE__*/React.createElement(HideBasedOnAuth, {
    requiredPermission: {
      module: 'webapi.Markers',
      method: 'GET'
    }
  }, /*#__PURE__*/React.createElement(LayersControl.Overlay, {
    name: "Markers"
  }, /*#__PURE__*/React.createElement(LayerGroup, null, markers)));
}
;// CONCATENATED MODULE: ../mods/markers/settings.js
function _extends() { _extends = Object.assign ? Object.assign.bind() : function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; return _extends.apply(this, arguments); }
/* eslint-disable react/prop-types */

function MarkersSettings({
  React,
  styled,
  HTTP,
  EditableTable,
  FormElements,
  TfpForm,
  useForm,
  useQuery,
  useMutation,
  checkPermission
}) {
  const {
    register,
    handleSubmit,
    formState: {
      errors
    },
    setValue
  } = useForm();
  const {
    data,
    refetch
  } = useQuery('markers', async () => HTTP.get('/api/markers'));
  const {
    mutate: createMarker
  } = useMutation('createMarker', data => HTTP.post('/api/markers', {
    name: data.name,
    x: parseInt(data.x, 10),
    y: parseInt(data.y, 10)
  }), {
    onSuccess: () => refetch()
  });
  const {
    mutate: deleteMarker
  } = useMutation('deleteMarker', id => HTTP.delete(`/api/markers/${id}`), {
    onSuccess: () => refetch()
  });
  const {
    mutate: updateMarker
  } = useMutation('updateMarker', data => HTTP.put(`/api/markers/${data.id}`, {
    name: data.name,
    x: parseInt(data.x, 10),
    y: parseInt(data.y, 10),
    icon: data.icon
  }), {
    onSuccess: () => refetch()
  });
  const canEditRows = checkPermission({
    module: 'webapi.Markers',
    method: 'PUT'
  });
  const canDeleteRows = checkPermission({
    module: 'webapi.Markers',
    method: 'DELETE'
  });
  const columnDef = [{
    field: 'id',
    filter: 'agTextColumnFilter',
    flex: 1
  }, {
    field: 'name',
    filter: 'agTextColumnFilter',
    flex: 1
  }, {
    field: 'x',
    filter: 'agNumberColumnFilter',
    flex: 0.25,
    sort: 'asc'
  }, {
    field: 'y',
    filter: 'agNumberColumnFilter',
    flex: 0.25,
    sort: 'asc'
  }, {
    field: 'icon',
    filter: 'agTextColumnFilter',
    flex: 1
  }];
  const Form = /*#__PURE__*/React.createElement(TfpForm, {
    id: "markers-form",
    error: errors
  }, /*#__PURE__*/React.createElement(FormElements.StyledFormItem, null, /*#__PURE__*/React.createElement(FormElements.FormLabel, {
    htmlFor: "input-id"
  }, "ID"), /*#__PURE__*/React.createElement(FormElements.FormInput, _extends({
    key: "id",
    id: "input-id"
  }, register('id'), {
    disabled: true
  }))), /*#__PURE__*/React.createElement(FormElements.StyledFormItem, null, /*#__PURE__*/React.createElement(FormElements.FormLabel, {
    htmlFor: "input-name"
  }, "Name"), /*#__PURE__*/React.createElement(FormElements.FormInput, _extends({
    key: "name",
    id: "input-name"
  }, register('name')))), /*#__PURE__*/React.createElement(FormElements.StyledFormItem, null, /*#__PURE__*/React.createElement(FormElements.FormLabel, {
    htmlFor: "input-x"
  }, "X"), /*#__PURE__*/React.createElement(FormElements.FormInput, _extends({
    key: "x",
    id: "input-x"
  }, register('x', {
    required: true
  })))), /*#__PURE__*/React.createElement(FormElements.StyledFormItem, null, /*#__PURE__*/React.createElement(FormElements.FormLabel, {
    htmlFor: "input-y"
  }, "Y"), /*#__PURE__*/React.createElement(FormElements.FormInput, _extends({
    key: "y",
    id: "input-y"
  }, register('y', {
    required: true
  })))));
  async function handleCreate(data) {
    if (!checkPermission({
      module: 'webapi.Markers',
      method: 'POST'
    })) {
      return;
    }
    createMarker(data);
  }
  async function handleEdit(data) {
    if (!checkPermission({
      module: 'webapi.Markers',
      method: 'PUT'
    })) {
      return;
    }
    updateMarker(data);
  }
  async function cellDeleted(row) {
    if (!checkPermission({
      module: 'webapi.Markers',
      method: 'DELETE'
    })) {
      return;
    }
    deleteMarker(row.id);
  }
  const setDefaultValues = data => {
    setValue('id', data.id);
    setValue('name', data.name);
    setValue('x', data.x);
    setValue('y', data.y);
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flexDirection: 'row',
      height: '80vh'
    }
  }, /*#__PURE__*/React.createElement(EditableTable, {
    columnDef: columnDef,
    rowData: data,
    reloadFn: refetch,
    deleteRowFn: cellDeleted,
    canDeleteRows: canDeleteRows,
    height: '90%',
    editRowFn: handleSubmit(handleEdit),
    editForm: Form,
    setDefaultValues: setDefaultValues,
    canEditRows: canEditRows,
    canCreateRows: canEditRows,
    createRowFn: handleSubmit(handleCreate)
  }));
}
;// CONCATENATED MODULE: ../mods/markers/index.js
/* eslint-disable react/prop-types */


const modId = 'TFP_MarkersExample';
const Markers = {
  about: `This mod manages markers on a Leaflet map.`,
  routes: {},
  settings: {
    'Map markers': MarkersSettings
  },
  mapComponents: [MarkersComponent]
};
window[modId] = Markers;
window.dispatchEvent(new Event(`mod:${modId}:ready`));
/******/ })()
;